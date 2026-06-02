# Voice-Campaign Chunk 2a: Campaign Backend & Logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server side of campaign-based calling — scheduling logic, CSV/manual lead import, campaign create+snapshot+CRUD, per-campaign metrics, and outcome→membership wiring — so Chunk 2b's UI has a complete, tested API to call.

**Architecture:** Pure logic (`lib/call-hours.ts`, CSV parse in `lib/leads/import.ts`, `lib/campaigns/select.ts`) is unit-tested with vitest. Thin Route Handlers (`app/api/...`) validate with zod, call into `lib/` + `getDb()`, and return the `{success,data|error}` envelope — following the existing route pattern (`withApi`, `ok`, `fail`, `getDb`, `isDbConfigured`, `getLogger`). Reuses Chunk 1's `lib/leads/import.ts` + migration 019 tables (`call_campaigns`, `campaign_leads`, `leads.call_segment`/`source`) and the existing `lib/analytics.ts` `computeAnalytics`.

**Tech Stack:** TypeScript, Next.js 14 App Router, Supabase (Postgres), zod, vitest.

Scope / guardrails:
- **No UI** (Chunk 2b). **No auto-build** of Segment-A demos on campaign create (building stays the existing operator-triggered flow — avoids burning paid Gemini/Cloudflare; campaign just snapshots leads). **No live dialing** (manual). **No push/deploy** and **no DB apply** by the worker — those are operator actions. Migration 019 is already applied.
- Spec: `docs/superpowers/specs/2026-06-01-campaign-based-calling-design.md`.
- Existing helpers to reuse: `web/lib/api-wrap.ts` (`withApi`), `web/lib/response.ts` (`ok`/`fail`), `web/lib/db.ts` (`getDb`), `web/lib/safe-db.ts` (`isDbConfigured`, `safeDb`), `web/lib/logger.ts` (`getLogger`), `web/lib/leads/import.ts` (`validateLeadInput`/`buildLeadRow`/`dedupeKey`), `web/lib/analytics.ts` (`computeAnalytics`), `web/lib/segment.ts` (`CallSegment`).
- Branch: create `feat/voice-campaign-ch2a` off `main` before starting.

## File structure (this chunk)
- `web/lib/call-hours.ts` (+ `.test.ts`) — country→tz map + `callableNow()`.
- `web/lib/leads/import.ts` — extend with `parseCsv()` + `mapCsvRow()` (tests in existing `import.test.ts`).
- `web/lib/campaigns/select.ts` (+ `.test.ts`) — pure snapshot selection.
- `web/lib/campaigns/import-batch.ts` — `ensureImportBatch()` (DB helper).
- `web/app/api/leads/route.ts` — `POST` manual add.
- `web/app/api/leads/import/route.ts` — `POST` CSV import.
- `web/app/api/campaigns/route.ts` — `POST` create+snapshot, `GET` list.
- `web/app/api/campaigns/[id]/route.ts` — `GET` detail, `PATCH` status.
- `web/app/api/campaigns/[id]/metrics/route.ts` — `GET` per-campaign analytics.
- `web/lib/analytics.ts` — add `loadCampaignAnalytics(campaignId)`.
- `web/app/api/leads/[id]/call/outcome/route.ts` — extend to update `campaign_leads.status`.

---

### Task 1: `lib/call-hours.ts` — scheduling logic (pure, TDD)

**Files:** Create `web/lib/call-hours.ts`; Create `web/lib/call-hours.test.ts`.

- [ ] **Step 1: Write the failing tests**

Create `web/lib/call-hours.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { campaignTimezone, callableNow } from "@/lib/call-hours";

const SCHED = { call_days: [1, 2, 3, 4, 5], call_start_hour: 9, call_end_hour: 17 };

describe("campaignTimezone", () => {
  it("maps a known country to its representative IANA tz", () => {
    expect(campaignTimezone("us")).toBe("America/New_York");
    expect(campaignTimezone("gb")).toBe("Europe/London");
  });
  it("falls back to UTC for unknown/empty", () => {
    expect(campaignTimezone(null)).toBe("UTC");
    expect(campaignTimezone("zz")).toBe("UTC");
  });
});

describe("callableNow", () => {
  // Wed 2026-06-03 14:00 UTC = 10:00 America/New_York (EDT, weekday) → inside window
  it("true inside the weekday window", () => {
    const now = new Date("2026-06-03T14:00:00Z");
    expect(callableNow({ ...SCHED, timezone: "America/New_York" }, now).callable).toBe(true);
  });
  // Wed 2026-06-03 02:00 UTC = 22:00 EDT previous day → outside window
  it("false outside the hour window", () => {
    const now = new Date("2026-06-03T02:00:00Z");
    const r = callableNow({ ...SCHED, timezone: "America/New_York" }, now);
    expect(r.callable).toBe(false);
    expect(r.reason).toBe("outside_hours");
  });
  // Sat 2026-06-06 14:00 UTC → weekday 6 not in [1..5]
  it("false on a disallowed weekday", () => {
    const now = new Date("2026-06-06T14:00:00Z");
    const r = callableNow({ ...SCHED, timezone: "America/New_York" }, now);
    expect(r.callable).toBe(false);
    expect(r.reason).toBe("outside_days");
  });
  it("unknown timezone → not callable (default-safe)", () => {
    const now = new Date("2026-06-03T14:00:00Z");
    const r = callableNow({ ...SCHED, timezone: "" }, now);
    expect(r.callable).toBe(false);
    expect(r.reason).toBe("unknown_tz");
  });
});
```

- [ ] **Step 2: Run → fail**

Run (from `web/`): `npm test -- call-hours` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/call-hours.ts`**

Create `web/lib/call-hours.ts`:
```ts
/**
 * call-hours.ts — Per-campaign calling-window logic. Pure, no I/O.
 *
 * Inputs:  a campaign schedule (days + hour window + timezone) and the current time
 * Outputs: campaignTimezone() maps a country to a representative IANA tz;
 *          callableNow() says whether a lead is callable right now (+ why not)
 * Used by: lib/analytics + the /campaigns queue ordering (Chunk 2b); the live-dial
 *          gate later (integration plan). `now` is injected so it's unit-testable.
 *
 * Representative-tz-per-country is an approximation (large countries span zones) —
 * fine for the single-country pilot. Unknown tz → NOT callable (never dial when we
 * can't prove we're in-hours).
 */

/** Lowercase ISO-3166 alpha-2 → representative IANA timezone. Extend as needed. */
const COUNTRY_TZ: Record<string, string> = {
  us: "America/New_York",
  ca: "America/Toronto",
  gb: "Europe/London",
  ie: "Europe/Dublin",
  au: "Australia/Sydney",
  nz: "Pacific/Auckland",
  ph: "Asia/Manila",
};

export function campaignTimezone(countryCode: string | null | undefined): string {
  if (!countryCode) return "UTC";
  return COUNTRY_TZ[countryCode.trim().toLowerCase()] ?? "UTC";
}

export interface CallWindow {
  call_days: number[]; // 1=Mon..7=Sun
  call_start_hour: number; // 0-23
  call_end_hour: number; // 0-23, exclusive upper bound
  timezone: string; // IANA; "" / invalid → not callable
}

export type NotCallableReason = "unknown_tz" | "outside_days" | "outside_hours";

export interface CallableResult {
  callable: boolean;
  reason?: NotCallableReason;
}

/** Local weekday (1=Mon..7=Sun) + hour (0-23) for `now` in `tz`, or null if tz invalid. */
function localParts(now: Date, tz: string): { weekday: number; hour: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "";
    const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const weekday = map[wd];
    let hour = parseInt(hourStr, 10);
    if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
    if (!weekday || Number.isNaN(hour)) return null;
    return { weekday, hour };
  } catch {
    return null;
  }
}

export function callableNow(win: CallWindow, now: Date): CallableResult {
  if (!win.timezone) return { callable: false, reason: "unknown_tz" };
  const parts = localParts(now, win.timezone);
  if (!parts) return { callable: false, reason: "unknown_tz" };
  if (!win.call_days.includes(parts.weekday)) return { callable: false, reason: "outside_days" };
  if (parts.hour < win.call_start_hour || parts.hour >= win.call_end_hour) {
    return { callable: false, reason: "outside_hours" };
  }
  return { callable: true };
}
```

- [ ] **Step 4: Run → pass**

Run (from `web/`): `npm test -- call-hours` → PASS (6 passed). Then `npm test` (all) + `npm run typecheck` (clean).

- [ ] **Step 5: Commit**
```bash
git add web/lib/call-hours.ts web/lib/call-hours.test.ts
git commit -m "feat(web): call-hours scheduling logic (callableNow + country→tz)"
```

---

### Task 2: CSV parsing in `lib/leads/import.ts` (pure, TDD)

**Files:** Modify `web/lib/leads/import.ts`; Modify `web/lib/leads/import.test.ts`.

- [ ] **Step 1: Add failing tests** — append to `web/lib/leads/import.test.ts`:
```ts
import { parseCsv, mapCsvRow } from "@/lib/leads/import";

describe("parseCsv", () => {
  it("parses a header + rows into objects (handles quoted commas)", () => {
    const text = 'name,phone,city\n"Joe, Inc",512-555-1234,Austin\nMaya LLC,5125550000,Dallas';
    const rows = parseCsv(text);
    expect(rows).toEqual([
      { name: "Joe, Inc", phone: "512-555-1234", city: "Austin" },
      { name: "Maya LLC", phone: "5125550000", city: "Dallas" },
    ]);
  });
  it("returns [] for empty/whitespace", () => {
    expect(parseCsv("   ")).toEqual([]);
  });
});

describe("mapCsvRow", () => {
  it("maps source columns to a RawLead via a column mapping", () => {
    const row = { Company: "Joe", Tel: "5125551234", Town: "Austin", Site: "" };
    const mapping = { business_name: "Company", phone: "Tel", city: "Town", website_url: "Site" };
    expect(mapCsvRow(row, mapping)).toEqual({
      business_name: "Joe",
      phone: "5125551234",
      city: "Austin",
      country_code: undefined,
      website_url: "",
    });
  });
});
```

- [ ] **Step 2: Run → fail**: `npm test -- import` → FAIL (`parseCsv` not exported).

- [ ] **Step 3: Implement** — append to `web/lib/leads/import.ts`:
```ts
/** Minimal RFC-4180-ish CSV parser: first row = headers, supports "quoted, fields". */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = splitCsvLines(text.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (cells[i] ?? "").trim()));
    return obj;
  });
}

function splitCsvLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Column mapping: target field → source CSV header. */
export interface CsvMapping {
  business_name?: string;
  phone: string;
  city?: string;
  country_code?: string;
  website_url?: string;
}

export function mapCsvRow(row: Record<string, string>, mapping: CsvMapping): RawLead {
  const pick = (key?: string) => (key ? row[key] : undefined);
  return {
    business_name: pick(mapping.business_name),
    phone: pick(mapping.phone),
    city: pick(mapping.city),
    country_code: pick(mapping.country_code),
    website_url: pick(mapping.website_url),
  };
}
```

- [ ] **Step 4: Run → pass**: `npm test -- import` → PASS. Then `npm test` + `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add web/lib/leads/import.ts web/lib/leads/import.test.ts
git commit -m "feat(web): CSV parse + column mapping in lead importer"
```

---

### Task 3: `lib/campaigns/select.ts` — snapshot selection (pure, TDD)

**Files:** Create `web/lib/campaigns/select.ts`; Create `web/lib/campaigns/select.test.ts`.

- [ ] **Step 1: Failing tests** — create `web/lib/campaigns/select.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { selectSnapshot } from "@/lib/campaigns/select";

const lead = (id: string, created_at: string, lifecycle_stage = "prospect") =>
  ({ id, created_at, lifecycle_stage });

describe("selectSnapshot", () => {
  it("takes the newest N, excludes suppressed", () => {
    const cands = [
      lead("a", "2026-06-01T00:00:00Z"),
      lead("b", "2026-06-03T00:00:00Z"),
      lead("c", "2026-06-02T00:00:00Z"),
      lead("d", "2026-06-04T00:00:00Z", "dnc"),
      lead("e", "2026-06-05T00:00:00Z", "unsubscribed"),
    ];
    expect(selectSnapshot(cands, 2)).toEqual(["b", "c"]);
  });
  it("returns all eligible when target exceeds count", () => {
    expect(selectSnapshot([lead("a", "2026-06-01T00:00:00Z")], 10)).toEqual(["a"]);
  });
  it("target<=0 → empty", () => {
    expect(selectSnapshot([lead("a", "2026-06-01T00:00:00Z")], 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fail**: `npm test -- select` → FAIL.

- [ ] **Step 3: Implement** — create `web/lib/campaigns/select.ts`:
```ts
/**
 * campaigns/select.ts — Pick the leads a campaign snapshots. Pure, no I/O.
 *
 * Inputs:  candidate leads (already filtered by segment/country/category in the query) + target count
 * Outputs: ordered lead ids (newest first, suppressed excluded, capped at target)
 * Used by: app/api/campaigns/route.ts (app-source snapshot)
 */

const SUPPRESSED = new Set(["dnc", "unsubscribed"]);

export interface Candidate {
  id: string;
  created_at: string;
  lifecycle_stage?: string | null;
}

export function selectSnapshot(candidates: Candidate[], targetCount: number): string[] {
  if (targetCount <= 0) return [];
  return candidates
    .filter((c) => !SUPPRESSED.has(c.lifecycle_stage ?? ""))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, targetCount)
    .map((c) => c.id);
}
```

- [ ] **Step 4: Run → pass**: `npm test -- select` → PASS. Then `npm test` + `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add web/lib/campaigns/select.ts web/lib/campaigns/select.test.ts
git commit -m "feat(web): pure campaign snapshot selection (newest-N, suppress-aware)"
```

---

### Task 4: Lead import routes (manual + CSV)

**Files:** Create `web/lib/campaigns/import-batch.ts`; Create `web/app/api/leads/route.ts`; Create `web/app/api/leads/import/route.ts`.

- [ ] **Step 1: `ensureImportBatch` helper** — create `web/lib/campaigns/import-batch.ts`:
```ts
/**
 * campaigns/import-batch.ts — Create the synthetic batch that holds imported leads.
 *
 * Inputs:  a SupabaseClient + a label (source/campaign name)
 * Outputs: the import batch id (leads.batch_id is NOT NULL, so imports need a batch)
 * Used by: app/api/leads/route.ts, app/api/leads/import/route.ts
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function ensureImportBatch(db: SupabaseClient, label: string): Promise<string> {
  const { data, error } = await db
    .from("batches")
    .insert({ niche: "import", city: label.slice(0, 80) || "manual", status: "done", scraped_count: 0 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ensureImportBatch.error: ${error?.message}`);
  return data.id as string;
}
```

- [ ] **Step 2: Manual add route** — create `web/app/api/leads/route.ts`:
```ts
/**
 * api/leads/route.ts — POST: add a single lead by hand (manual source).
 *
 * Body: { business_name?, phone, city?, country_code?, website_url? }
 * Creates (or reuses) a manual import batch, inserts one validated lead.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { validateLeadInput, buildLeadRow } from "@/lib/leads/import";
import { ensureImportBatch } from "@/lib/campaigns/import-batch";

const Body = z.object({
  business_name: z.string().optional(),
  phone: z.string(),
  city: z.string().optional(),
  country_code: z.string().optional(),
  website_url: z.string().optional(),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);

  const v = validateLeadInput(parsed.data, "manual");
  if (!v.ok) return fail(v.error, 400);

  const db = getDb();
  const batchId = await ensureImportBatch(db, "manual add");
  const row = buildLeadRow(v.lead, batchId);
  const { data, error } = await db.from("leads").insert(row).select("id").single();
  if (error) return fail(`insert failed: ${error.message}`, 502);
  return ok({ lead_id: data.id, batch_id: batchId });
});
```

- [ ] **Step 3: CSV import route** — create `web/app/api/leads/import/route.ts`:
```ts
/**
 * api/leads/import/route.ts — POST: import leads from CSV text.
 *
 * Body: { csv_text, mapping: { business_name?, phone, city?, country_code?, website_url? } }
 * Parses CSV, maps columns, validates + normalizes phones, dedupes by phone within the
 * upload, inserts under one import batch. Returns { batch_id, imported, skipped, lead_ids }.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { parseCsv, mapCsvRow, validateLeadInput, buildLeadRow, dedupeKey } from "@/lib/leads/import";
import { ensureImportBatch } from "@/lib/campaigns/import-batch";

const Body = z.object({
  csv_text: z.string().min(1),
  mapping: z.object({
    business_name: z.string().optional(),
    phone: z.string(),
    city: z.string().optional(),
    country_code: z.string().optional(),
    website_url: z.string().optional(),
  }),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);

  const rows = parseCsv(parsed.data.csv_text);
  if (rows.length === 0) return fail("No data rows in CSV", 400);

  const db = getDb();
  const batchId = await ensureImportBatch(db, "csv import");
  const seen = new Set<string>();
  const toInsert = [];
  let skipped = 0;
  for (const raw of rows) {
    const v = validateLeadInput(mapCsvRow(raw, parsed.data.mapping), "csv");
    if (!v.ok) { skipped++; continue; }
    const key = dedupeKey(v.lead);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    toInsert.push(buildLeadRow(v.lead, batchId));
  }
  if (toInsert.length === 0) return fail(`All ${rows.length} rows invalid/duplicate`, 400);

  const { data, error } = await db.from("leads").insert(toInsert).select("id");
  if (error) return fail(`insert failed: ${error.message}`, 502);
  return ok({ batch_id: batchId, imported: data.length, skipped, lead_ids: data.map((d) => d.id) });
});
```

- [ ] **Step 4: Typecheck** — `npm run typecheck` (clean). (These are DB-integration routes; no unit test — verified by typecheck + the operator smoke-test in the final step.)

- [ ] **Step 5: Commit**
```bash
git add web/lib/campaigns/import-batch.ts web/app/api/leads/route.ts web/app/api/leads/import/route.ts
git commit -m "feat(api): manual + CSV lead import routes (import batch + dedupe)"
```

---

### Task 5: Campaign routes (create+snapshot, list, detail, status)

**Files:** Create `web/app/api/campaigns/route.ts`; Create `web/app/api/campaigns/[id]/route.ts`.

- [ ] **Step 1: Create + list** — create `web/app/api/campaigns/route.ts`:
```ts
/**
 * api/campaigns/route.ts — POST: create a campaign + snapshot its leads. GET: list.
 *
 * POST body (app source):    { name, source:'app', segment, country_code, category?, target_count, schedule }
 * POST body (csv/manual):    { name, source, segment, lead_ids[], schedule }
 *   schedule = { call_days?, call_start_hour?, call_end_hour? } (defaults 9-17 Mon-Fri)
 * Snapshots membership into campaign_leads. status starts 'active' (no auto-build in 2a).
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { selectSnapshot } from "@/lib/campaigns/select";
import { campaignTimezone } from "@/lib/call-hours";

const SEGMENTS = ["no_website", "old_website", "has_website"] as const;
const Body = z.object({
  name: z.string().min(1),
  source: z.enum(["app", "csv", "manual"]).default("app"),
  segment: z.enum(SEGMENTS).optional(),
  country_code: z.string().optional(),
  category: z.string().optional(),
  target_count: z.number().int().positive().max(5000).optional(),
  lead_ids: z.array(z.string().uuid()).optional(),
  call_days: z.array(z.number().int().min(1).max(7)).optional(),
  call_start_hour: z.number().int().min(0).max(23).optional(),
  call_end_hour: z.number().int().min(0).max(23).optional(),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  const b = parsed.data;
  const db = getDb();

  // Resolve the snapshot lead-id list.
  let leadIds: string[] = [];
  if (b.source === "app") {
    if (!b.segment || !b.target_count) return fail("app source needs segment + target_count", 400);
    let q = db
      .from("leads")
      .select("id,created_at,lifecycle_stage")
      .eq("call_segment", b.segment)
      .neq("qualified", false)
      .limit(20000);
    if (b.country_code) q = q.eq("country_code", b.country_code.toLowerCase());
    if (b.category) q = q.eq("category", b.category);
    const { data: cands, error } = await q;
    if (error) return fail(`lead query failed: ${error.message}`, 502);
    leadIds = selectSnapshot((cands ?? []) as never[], b.target_count);
  } else {
    if (!b.lead_ids?.length) return fail(`${b.source} source needs lead_ids`, 400);
    leadIds = b.lead_ids;
  }
  if (leadIds.length === 0) return fail("No matching leads to snapshot", 400);

  const { data: camp, error: cErr } = await db
    .from("call_campaigns")
    .insert({
      name: b.name,
      source: b.source,
      segment: b.segment ?? null,
      country_code: b.country_code?.toLowerCase() ?? null,
      category: b.category ?? null,
      target_count: b.target_count ?? leadIds.length,
      call_days: b.call_days ?? [1, 2, 3, 4, 5],
      call_start_hour: b.call_start_hour ?? 9,
      call_end_hour: b.call_end_hour ?? 17,
      timezone: campaignTimezone(b.country_code),
      status: "active",
    })
    .select("*")
    .single();
  if (cErr || !camp) return fail(`campaign insert failed: ${cErr?.message}`, 502);

  const membership = leadIds.map((lead_id) => ({ campaign_id: camp.id, lead_id }));
  const { error: mErr } = await db.from("campaign_leads").insert(membership);
  if (mErr) return fail(`membership insert failed: ${mErr.message}`, 502);

  return ok({ campaign: camp, snapshot_count: leadIds.length });
});

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const { data, error } = await getDb()
    .from("call_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return fail(error.message, 502);
  return ok({ campaigns: data ?? [] });
});
```

- [ ] **Step 2: Detail + status** — create `web/app/api/campaigns/[id]/route.ts`:
```ts
/**
 * api/campaigns/[id]/route.ts — GET: campaign + membership counts. PATCH: status.
 *
 * PATCH body: { status: 'active'|'paused'|'done' }
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const db = getDb();
  const { data: camp, error } = await db.from("call_campaigns").select("*").eq("id", params.id).single();
  if (error || !camp) return fail("campaign not found", 404);
  const { data: members } = await db
    .from("campaign_leads")
    .select("status")
    .eq("campaign_id", params.id);
  const counts: Record<string, number> = {};
  for (const m of members ?? []) counts[m.status] = (counts[m.status] ?? 0) + 1;
  return ok({ campaign: camp, member_counts: counts, total: members?.length ?? 0 });
});

const Patch = z.object({ status: z.enum(["active", "paused", "done"]) });

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  const { data, error } = await getDb()
    .from("call_campaigns")
    .update({ status: parsed.data.status })
    .eq("id", params.id)
    .select("id,status")
    .single();
  if (error) return fail(error.message, 502);
  return ok(data);
});
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` (clean).

- [ ] **Step 4: Commit**
```bash
git add web/app/api/campaigns/route.ts "web/app/api/campaigns/[id]/route.ts"
git commit -m "feat(api): campaign create+snapshot, list, detail, status routes"
```

---

### Task 6: Per-campaign metrics

**Files:** Modify `web/lib/analytics.ts`; Create `web/app/api/campaigns/[id]/metrics/route.ts`.

- [ ] **Step 1: Add `loadCampaignAnalytics`** — in `web/lib/analytics.ts`, add (reusing the existing `computeAnalytics` + the row-shape interfaces already in the file):
```ts
/**
 * Campaign-scoped analytics: same shape as loadAnalytics, but scoped to a campaign's
 * snapshot membership (campaign_leads) instead of a batch. Reuses computeAnalytics.
 */
export async function loadCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
  const empty = computeAnalytics([], [], [], 0);
  return safeDb<CampaignAnalytics>(async (db) => {
    const { data: members } = await db
      .from("campaign_leads")
      .select("lead_id")
      .eq("campaign_id", campaignId)
      .limit(20000);
    const ids = new Set((members ?? []).map((m: { lead_id: string }) => m.lead_id));
    if (ids.size === 0) return empty;

    const { data: leadRows } = await db
      .from("leads")
      .select("id,qualified,call_status,lifecycle_stage,primary_offer")
      .limit(20000);
    const leads = ((leadRows ?? []) as LeadRow[]).filter((l) => ids.has(l.id));

    const [{ data: callsData }, { data: eventsData }] = await Promise.all([
      db.from("call_attempts").select("lead_id,status,outcome,offer_pitched").limit(50000),
      db.from("outreach_events").select("lead_id,kind").limit(50000),
    ]);
    const calls = ((callsData ?? []) as CallRow[]).filter((c) => ids.has(c.lead_id));
    const events = ((eventsData ?? []) as EventRow[]).filter((e) => e.lead_id && ids.has(e.lead_id));
    return computeAnalytics(leads, calls, events, 0);
  }, empty);
}
```
(If `LeadRow`/`CallRow`/`EventRow` are not exported in analytics.ts, reference them directly — they are declared in that file; this function lives in the same file so it can use them.)

- [ ] **Step 2: Metrics route** — create `web/app/api/campaigns/[id]/metrics/route.ts`:
```ts
/**
 * api/campaigns/[id]/metrics/route.ts — GET campaign-scoped funnel/conversion/monitoring.
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { loadCampaignAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const data = await loadCampaignAnalytics(params.id);
  return ok({ campaign_id: params.id, ...data });
});
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` (clean). Then `npm test` (existing 25+ tests still pass).

- [ ] **Step 4: Commit**
```bash
git add web/lib/analytics.ts "web/app/api/campaigns/[id]/metrics/route.ts"
git commit -m "feat(api,analytics): per-campaign metrics endpoint"
```

---

### Task 7: Wire call outcome → `campaign_leads.status`

**Files:** Modify `web/app/api/leads/[id]/call/outcome/route.ts`.

- [ ] **Step 1: Extend the outcome handler.** After the existing logic that updates `call_attempts` + `leads` + writes the `outreach_events` row (keep all of it), add a best-effort update of any `campaign_leads` rows for this lead. Map the outcome to the membership status:
```ts
// Reflect the outcome onto any campaign membership (best-effort; never fail the request).
try {
  const campaignStatus =
    body.outcome === "interested" ? "interested"
    : body.outcome === "not_interested" || body.outcome === "wrong_number" ? "done"
    : body.outcome === "do_not_call" ? "skipped"
    : "called"; // callback / status-only dispositions
  await db.from("campaign_leads").update({ status: campaignStatus }).eq("lead_id", params.id);
} catch (err) {
  log.warn({ lead_id: params.id, err: String(err).slice(0, 200) }, "campaign_leads.update_failed");
}
```
Place it just before the success `return ok(...)`. Use the route's existing `db`, `body`, `params`, and `log` bindings (match their actual names in the file — read it first).

- [ ] **Step 2: Typecheck** — `npm run typecheck` (clean).

- [ ] **Step 3: Commit**
```bash
git add "web/app/api/leads/[id]/call/outcome/route.ts"
git commit -m "feat(api): reflect call outcome onto campaign_leads.status"
```

---

## Self-Review

**Spec coverage (Chunk 2a scope):**
- Scheduling / callable-now → Task 1 ✓
- CSV + manual lead intake (3-source foundation made callable) → Tasks 2, 4 ✓
- Campaign create + snapshot + list + detail + status → Tasks 3, 5 ✓
- Per-campaign metrics → Task 6 ✓
- Outcome → membership → Task 7 ✓
- (Deferred to 2b: `/campaigns` list + builder UI, `/campaigns/[id]` queue UI, nav, callable-now sorting in the view. Deferred elsewhere: Segment-A auto-build on activate, live dialing, dashboard reorientation = Chunk 3.)

**Placeholder scan:** none — pure-logic tasks have full code + tests; routes have full code; Task 7 references the file's existing bindings (worker reads the file first).

**Type consistency:** `CallSegment` segment values match across select/campaign routes + DB checks. `campaign_leads.status` values (`pending|called|interested|done|skipped`) match the Task-7 mapping and migration 019. `CallWindow` from call-hours is consumed by 2b (not here). `computeAnalytics` reused unchanged; `loadCampaignAnalytics` mirrors `loadAnalytics`.

## Verification (end of chunk, mostly $0)
- `npm test` green (call-hours, csv parse, select + Chunk-1 suites). `npm run typecheck` clean.
- **Operator smoke (optional, reads/writes the dev DB):** `POST /api/leads` with a phone → 200 + lead_id; `POST /api/leads/import` with a 2-row CSV → imported:2; `POST /api/campaigns` (app source, segment=no_website, target_count=5) → snapshot_count>0; `GET /api/campaigns` lists it; `PATCH /api/campaigns/[id]` {status:'paused'} → 200; `GET /api/campaigns/[id]/metrics` → funnel JSON. (Hits Supabase; run only if you want the live check — no paid APIs involved.)

## Execution Handoff
Subagent-driven (recommended) or inline. No push / no DB apply by the worker.
