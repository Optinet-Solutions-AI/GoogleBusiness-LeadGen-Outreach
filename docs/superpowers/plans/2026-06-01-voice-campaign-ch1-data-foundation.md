# Voice-Campaign Chunk 1: Data Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the data + pure-logic foundation for campaign-based calling — a lead **segment**, a lead **source**, the **call_campaigns / campaign_leads** tables, the offer-router change that keeps good-website leads callable, and a shared **lead importer** — all unit-tested.

**Architecture:** Pure, side-effect-free modules (`lib/segment.ts`, `lib/leads/import.ts`) carry the logic and are unit-tested with vitest. `lib/offers.ts` composes the segment deriver. The DB migration is additive (house style: `add ... if not exists`, RLS disabled) and hand-ported into `db/schema.sql`. No UI, no campaign routes, no live calling — those are Chunk 2/3.

**Tech Stack:** TypeScript, Next.js 14, Supabase (Postgres), zod, **vitest** (new, for unit tests).

Scope notes:
- This plan produces working, testable software on its own: tested pure modules + a valid migration + an offer-router behavior change verified by `tsc` and unit tests.
- **DB + deploy are operator actions.** Applying migration `019` to Supabase and any `git push` (which auto-deploys) are done by the operator — the plan ends each at "hand to operator," never run by the worker.
- Spec: `docs/superpowers/specs/2026-06-01-campaign-based-calling-design.md`.

## File structure (this chunk)
- `web/vitest.config.ts` — new; test runner config + `@/` alias.
- `web/lib/segment.ts` — new; `deriveSegment()` (pure) + `CallSegment` type.
- `web/lib/segment.test.ts` — new; unit tests.
- `web/lib/offers.ts` — modify; add `segment` to `OfferRoute`, keep good-website callable.
- `web/lib/offers.test.ts` — new; unit tests for `routeOffer`.
- `web/lib/pipeline/stage-1-scrape.ts` — modify; set `call_segment`, drop the good-website demotion.
- `web/lib/leads/import.ts` — new; `normalizePhone` / `validateLeadInput` / `dedupeKey` / `buildLeadRow` (pure).
- `web/lib/leads/import.test.ts` — new; unit tests.
- `db/migrations/019_call_campaigns.sql` — new; `leads.call_segment`, `leads.source`, `call_campaigns`, `campaign_leads`.
- `db/schema.sql` — modify; hand-port migration 019.

---

### Task 1: Add the vitest test harness

**Files:**
- Modify: `web/package.json` (scripts + devDependency)
- Create: `web/vitest.config.ts`
- Create: `web/lib/segment.test.ts` (placeholder sanity test, replaced in Task 2)

- [ ] **Step 1: Install vitest (dev dependency)**

Run (from `web/`): `npm install -D vitest`
Expected: `package.json` gains `"vitest"` under devDependencies; no errors.
Why: the repo has no test runner; vitest runs TS natively (matches the `tsx` toolchain) and gives us TDD for the pure modules. This is the only new dependency in this chunk.

- [ ] **Step 2: Create the vitest config with the `@/` alias**

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirrors tsconfig "@/*" → web-root so tests can import "@/lib/...".
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
```

- [ ] **Step 3: Add test scripts**

In `web/package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write a sanity test**

Create `web/lib/segment.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run (from `web/`): `npm test`
Expected: PASS — 1 passed.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/lib/segment.test.ts
git commit -m "test(web): add vitest harness for pure-logic unit tests"
```

---

### Task 2: `lib/segment.ts` — derive the call segment (pure, TDD)

**Files:**
- Create: `web/lib/segment.ts`
- Test: `web/lib/segment.test.ts` (replace the sanity test)

- [ ] **Step 1: Write the failing tests**

Replace `web/lib/segment.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { deriveSegment } from "@/lib/segment";

describe("deriveSegment", () => {
  it("no real website → no_website", () => {
    expect(deriveSegment({ has_website: false })).toBe("no_website");
  });
  it("real website that needs improvement → old_website", () => {
    expect(deriveSegment({ has_website: true, needs_improvement: true })).toBe("old_website");
  });
  it("real healthy website → has_website", () => {
    expect(deriveSegment({ has_website: true, needs_improvement: false })).toBe("has_website");
  });
  it("real website not yet audited (null) → has_website (don't assume it's bad)", () => {
    expect(deriveSegment({ has_website: true, needs_improvement: null })).toBe("has_website");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- segment`
Expected: FAIL — cannot find module `@/lib/segment`.

- [ ] **Step 3: Implement `lib/segment.ts`**

Create `web/lib/segment.ts`:

```ts
/**
 * segment.ts — Derive the call SEGMENT for a lead. Pure, no I/O.
 *
 * Inputs:  { has_website, needs_improvement } (audit signals)
 * Outputs: CallSegment — drives which campaign/script a lead belongs to
 * Used by: lib/offers.ts (routeOffer), lib/leads/import.ts
 *
 * Three segments (see docs/superpowers/specs/2026-06-01-campaign-based-calling-design.md):
 *   no_website   — no real website        → build pitch
 *   old_website  — real but needs work    → improve pitch
 *   has_website  — real + healthy         → discovery/menu pitch (kept, not dropped)
 */

export const CALL_SEGMENTS = ["no_website", "old_website", "has_website"] as const;
export type CallSegment = (typeof CALL_SEGMENTS)[number];

export interface SegmentSignals {
  /** A REAL owned website (not a social/listing page). */
  has_website: boolean;
  /** Auditor verdict; only meaningful when has_website. null = not audited. */
  needs_improvement?: boolean | null;
}

export function deriveSegment(signals: SegmentSignals): CallSegment {
  if (!signals.has_website) return "no_website";
  // null/undefined audit → treat as healthy (don't pitch "improve" on an unaudited site).
  return signals.needs_improvement === true ? "old_website" : "has_website";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- segment`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add web/lib/segment.ts web/lib/segment.test.ts
git commit -m "feat(web): add deriveSegment (no_website/old_website/has_website)"
```

---

### Task 3: `routeOffer` keeps good-website leads + carries the segment (TDD), then wire into enrich

**Files:**
- Modify: `web/lib/offers.ts`
- Create: `web/lib/offers.test.ts`
- Modify: `web/lib/pipeline/stage-1-scrape.ts` (enrichOne)

- [ ] **Step 1: Write the failing tests for the new routeOffer**

Create `web/lib/offers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { routeOffer } from "@/lib/offers";

describe("routeOffer", () => {
  it("no website → build_website, segment no_website, qualifies", () => {
    const r = routeOffer({ has_website: false });
    expect(r.qualifies).toBe(true);
    expect(r.primary_offer).toBe("build_website");
    expect(r.secondary_offer).toBe("voice_agent");
    expect(r.segment).toBe("no_website");
  });
  it("old website → improve_website, segment old_website", () => {
    const r = routeOffer({ has_website: true, needs_improvement: true });
    expect(r.primary_offer).toBe("improve_website");
    expect(r.segment).toBe("old_website");
    expect(r.qualifies).toBe(true);
  });
  it("healthy website → KEPT (qualifies), no primary offer, segment has_website", () => {
    const r = routeOffer({ has_website: true, needs_improvement: false });
    expect(r.qualifies).toBe(true);          // was false before — now callable
    expect(r.primary_offer).toBeNull();      // menu/discovery call, not a single pitch
    expect(r.secondary_offer).toBe("voice_agent");
    expect(r.segment).toBe("has_website");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- offers`
Expected: FAIL — `r.segment` is undefined and the healthy-website case returns `qualifies: false`.

- [ ] **Step 3: Update `lib/offers.ts`**

Replace the `OfferRoute` interface and `routeOffer` function in `web/lib/offers.ts` with:

```ts
import { deriveSegment, type CallSegment } from "./segment";

export interface OfferRoute {
  /** Always true now — all three segments are worth a call. Kept for callers. */
  qualifies: boolean;
  /** null for has_website (the discovery/menu call pitches no single offer). */
  primary_offer: Offer | null;
  secondary_offer: Offer | null;
  /** Which segment/script this lead belongs to. */
  segment: CallSegment;
  /** Reserved for future hard-drops; null in the 3-segment model. */
  reason: string | null;
}

/**
 * Route a lead to its segment + offers.
 *   no real website                 → build_website   (+ voice_agent attach)
 *   real website + needs_improvement → improve_website (+ voice_agent attach)
 *   real website + healthy           → KEEP for the discovery/menu call (primary null)
 */
export function routeOffer(signals: OfferSignals): OfferRoute {
  const segment = deriveSegment(signals);
  if (segment === "no_website") {
    return { qualifies: true, primary_offer: "build_website", secondary_offer: "voice_agent", segment, reason: null };
  }
  if (segment === "old_website") {
    return { qualifies: true, primary_offer: "improve_website", secondary_offer: "voice_agent", segment, reason: null };
  }
  return { qualifies: true, primary_offer: null, secondary_offer: "voice_agent", segment, reason: null };
}
```

Keep `OFFERS`, `OFFER_LABEL`, `Offer`, and `OfferSignals` as they are. (`OfferSignals` already has `has_website` + `needs_improvement`, matching `SegmentSignals`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- offers segment`
Expected: PASS — all offers + segment tests pass.

- [ ] **Step 5: Wire the segment into enrich + drop the good-website demotion**

In `web/lib/pipeline/stage-1-scrape.ts`, inside `enrichOne`, replace the block that currently reads:

```ts
  const route = routeOffer({
    has_website: hasWebsite,
    needs_improvement: (row.needs_improvement as boolean | null) ?? null,
  });
  if (!route.qualifies) {
    // Healthy real website — demote. Keep audit fields for visibility; skip
    // the (now-pointless) color/logo enrichment and stay at stage='scraped'.
    row.qualified = false;
    row.rejection_reason = route.reason;
    return;
  }
  row.primary_offer = route.primary_offer;
  row.secondary_offer = route.secondary_offer;
```

with:

```ts
  const route = routeOffer({
    has_website: hasWebsite,
    needs_improvement: (row.needs_improvement as boolean | null) ?? null,
  });
  row.call_segment = route.segment;
  row.primary_offer = route.primary_offer;
  row.secondary_offer = route.secondary_offer;
  if (route.segment === "has_website") {
    // Healthy real site → kept for the discovery/menu call. No build, so skip the
    // build-oriented color/logo enrichment. (Was previously demoted to qualified=false.)
    row.stage = "enriched";
    return;
  }
```

(Leave the rest of `enrichOne` — color/logo for build/improve leads + the final `row.stage = "enriched"` — unchanged.)

- [ ] **Step 6: Typecheck**

Run (from `web/`): `npm run typecheck`
Expected: PASS — no errors. (`row.call_segment` is an untyped `Record<string, unknown>` field, so no type change is needed here; the column is added in Task 5.)

- [ ] **Step 7: Commit**

```bash
git add web/lib/offers.ts web/lib/offers.test.ts web/lib/pipeline/stage-1-scrape.ts
git commit -m "feat(pipeline): keep good-website leads + set call_segment (3-segment routing)"
```

---

### Task 4: `lib/leads/import.ts` — shared lead intake (pure, TDD)

**Files:**
- Create: `web/lib/leads/import.ts`
- Test: `web/lib/leads/import.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/lib/leads/import.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizePhone, validateLeadInput, dedupeKey, buildLeadRow } from "@/lib/leads/import";

describe("normalizePhone", () => {
  it("formats a 10-digit US number to E.164", () => {
    expect(normalizePhone("(512) 555-1234")).toBe("+15125551234");
  });
  it("keeps an existing +country number", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects junk / empty", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("validateLeadInput", () => {
  it("accepts a row with a valid phone", () => {
    const r = validateLeadInput({ business_name: "Joe's Plumbing", phone: "512-555-1234", website_url: "" }, "csv");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead.phone).toBe("+15125551234");
      expect(r.lead.has_website).toBe(false);
      expect(r.lead.source).toBe("csv");
    }
  });
  it("rejects a row with no usable phone", () => {
    const r = validateLeadInput({ business_name: "No Phone Co", phone: "nope" }, "manual");
    expect(r.ok).toBe(false);
  });
  it("flags has_website when a website is present", () => {
    const r = validateLeadInput({ phone: "5125551234", website_url: "http://x.com" }, "csv");
    expect(r.ok && r.lead.has_website).toBe(true);
  });
});

describe("dedupeKey", () => {
  it("is the normalized phone", () => {
    expect(dedupeKey({ phone: "+15125551234" })).toBe("+15125551234");
  });
});

describe("buildLeadRow", () => {
  it("maps to a leads row; no-website import → call_segment no_website", () => {
    const lead = { business_name: "Joe's", phone: "+15125551234", city: "Austin", country_code: "us", website_url: null, has_website: false, source: "csv" as const };
    const row = buildLeadRow(lead, "batch-1");
    expect(row.batch_id).toBe("batch-1");
    expect(row.source).toBe("csv");
    expect(row.has_website).toBe(false);
    expect(row.call_segment).toBe("no_website");
    expect(row.stage).toBe("scraped");
  });
  it("import WITH a website leaves call_segment null (operator's campaign segment governs)", () => {
    const lead = { business_name: "Has Site", phone: "+15125551235", city: null, country_code: null, website_url: "http://x.com", has_website: true, source: "manual" as const };
    const row = buildLeadRow(lead, "batch-1");
    expect(row.call_segment).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- import`
Expected: FAIL — cannot find module `@/lib/leads/import`.

- [ ] **Step 3: Implement `lib/leads/import.ts`**

Create `web/lib/leads/import.ts`:

```ts
/**
 * leads/import.ts — Shared lead intake for app / CSV / manual sources. Pure helpers.
 *
 * Inputs:  raw lead rows (CSV row or manual form) + source
 * Outputs: validated/normalized LeadInput, a dedupe key, and a leads-table row
 * Used by: app/api/leads/import (CSV), app/api/leads (manual) — wired in Chunk 2
 *
 * The source-agnostic seam: every source funnels through validate → normalize →
 * dedupe → buildLeadRow, so adding a new source later is just a new caller.
 * DB insert lives in the route (Chunk 2); these functions stay pure + unit-tested.
 */

import { deriveSegment, type CallSegment } from "../segment";

export type LeadSource = "scraped" | "csv" | "manual";

export interface RawLead {
  business_name?: string;
  phone?: string;
  city?: string;
  country_code?: string;
  website_url?: string;
}

export interface LeadInput {
  business_name: string;
  phone: string;
  city: string | null;
  country_code: string | null;
  website_url: string | null;
  has_website: boolean;
  source: Exclude<LeadSource, "scraped">;
}

/** Best-effort E.164 normalization. Bare 10-digit numbers assume NANP (+1). */
export function normalizePhone(raw: string | undefined | null, defaultCc = "1"): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCc}${digits}`;
  return `+${digits}`;
}

export function validateLeadInput(
  raw: RawLead,
  source: Exclude<LeadSource, "scraped">,
  defaultCc = "1",
): { ok: true; lead: LeadInput } | { ok: false; error: string } {
  const phone = normalizePhone(raw.phone, defaultCc);
  if (!phone) return { ok: false, error: "missing or invalid phone" };
  const website = raw.website_url?.trim() || null;
  return {
    ok: true,
    lead: {
      business_name: raw.business_name?.trim() || "Unknown business",
      phone,
      city: raw.city?.trim() || null,
      country_code: raw.country_code?.trim().toLowerCase() || null,
      website_url: website,
      has_website: Boolean(website),
      source,
    },
  };
}

export function dedupeKey(lead: { phone: string }): string {
  return lead.phone;
}

export interface LeadRow {
  batch_id: string;
  business_name: string;
  phone: string;
  address: string | null;
  country_code: string | null;
  website_url: string | null;
  has_website: boolean;
  source: LeadSource;
  call_segment: CallSegment | null;
  stage: string;
}

/**
 * Map a validated LeadInput to a leads-table row under an import batch.
 * No-website imports get call_segment='no_website'; website-bearing imports leave it
 * null (not audited here) — the operator's campaign segment selects the script.
 */
export function buildLeadRow(lead: LeadInput, importBatchId: string): LeadRow {
  return {
    batch_id: importBatchId,
    business_name: lead.business_name,
    phone: lead.phone,
    address: lead.city,
    country_code: lead.country_code,
    website_url: lead.website_url,
    has_website: lead.has_website,
    source: lead.source,
    call_segment: lead.has_website ? null : deriveSegment({ has_website: false }),
    stage: "scraped",
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- import`
Expected: PASS — all import tests pass.

- [ ] **Step 5: Full test + typecheck**

Run (from `web/`): `npm test && npm run typecheck`
Expected: PASS — all suites pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add web/lib/leads/import.ts web/lib/leads/import.test.ts
git commit -m "feat(web): shared lead importer (validate/normalize/dedupe) for app/csv/manual"
```

---

### Task 5: Migration 019 — segment, source, campaigns

**Files:**
- Create: `db/migrations/019_call_campaigns.sql`
- Modify: `db/schema.sql` (hand-port)

- [ ] **Step 1: Write the migration**

Create `db/migrations/019_call_campaigns.sql`:

```sql
-- 019_call_campaigns.sql — campaign-based calling + lead segment/source.
--
-- Adds:
--   leads.call_segment  — no_website | old_website | has_website (3-segment routing)
--   leads.source        — scraped | csv | manual (lead origin)
--   call_campaigns       — a saved calling job (segment + filters/source + schedule)
--   campaign_leads       — snapshot membership + per-campaign call status
--
-- Additive + idempotent. Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/019_call_campaigns.sql   (run by the operator)

-- ── leads: segment + source ───────────────────────────────────────────
alter table leads add column if not exists call_segment text
    check (call_segment in ('no_website','old_website','has_website'));
alter table leads add column if not exists source text not null default 'scraped'
    check (source in ('scraped','csv','manual'));
create index if not exists leads_call_segment_idx on leads(call_segment);

-- ── call_campaigns ────────────────────────────────────────────────────
create table if not exists call_campaigns (
    id              uuid primary key default uuid_generate_v4(),
    name            text not null,
    source          text not null default 'app'
                    check (source in ('app','csv','manual')),
    segment         text
                    check (segment in ('no_website','old_website','has_website')),
    country_code    text,                              -- app source filter
    category        text,                              -- app source filter (null = any)
    batch_id        uuid references batches(id) on delete set null,
    target_count    int,
    call_days       int[] not null default '{1,2,3,4,5}',   -- 1=Mon..7=Sun
    call_start_hour int  not null default 9  check (call_start_hour between 0 and 23),
    call_end_hour   int  not null default 20 check (call_end_hour   between 0 and 23),
    timezone        text,                              -- IANA, derived from country_code
    status          text not null default 'draft'
                    check (status in ('draft','building','active','paused','done')),
    created_at      timestamptz not null default now()
);
create index if not exists call_campaigns_status_idx on call_campaigns(status);
alter table if exists call_campaigns disable row level security;

-- ── campaign_leads (snapshot membership) ──────────────────────────────
create table if not exists campaign_leads (
    campaign_id uuid not null references call_campaigns(id) on delete cascade,
    lead_id     uuid not null references leads(id)          on delete cascade,
    status      text not null default 'pending'
                check (status in ('pending','called','interested','done','skipped')),
    added_at    timestamptz not null default now(),
    primary key (campaign_id, lead_id)
);
create index if not exists campaign_leads_lead_idx on campaign_leads(lead_id);
alter table if exists campaign_leads disable row level security;
```

- [ ] **Step 2: Hand-port into `db/schema.sql`**

In `db/schema.sql`: add the two `leads` columns (`call_segment`, `source`) to the `leads` table definition, append the `call_campaigns` and `campaign_leads` table definitions (mirror the SQL above), and add both new tables to the RLS-disable list at the bottom of the file. Match the file's existing comment style.

- [ ] **Step 3: Verify SQL shape (no DB write)**

Run (from repo root): `grep -n "call_segment\|call_campaigns\|campaign_leads\|leads.*source" db/schema.sql`
Expected: the new columns + tables appear in `db/schema.sql` (proof the port landed). The worker does NOT apply the migration.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/019_call_campaigns.sql db/schema.sql
git commit -m "feat(db): migration 019 — leads.call_segment/source + call_campaigns/campaign_leads"
```

- [ ] **Step 5: Hand to operator (DB apply)**

Tell the operator: *"Migration `019` is ready. Apply it to Supabase when you're ready:*
`psql "$SUPABASE_URL" -f db/migrations/019_call_campaigns.sql`*. I won't run it (DB changes are yours)."*
Then re-scrape (or backfill) a small batch and confirm `leads.call_segment` is populated for A/B/C and a healthy-website lead now has `qualified=true` (no longer demoted).

---

## Self-Review

**Spec coverage (Chunk 1 scope):**
- `call_segment` + keep good-website callable → Tasks 2, 3 ✓
- `leads.source` + 3-source intake foundation → Tasks 4, 5 ✓
- `call_campaigns` / `campaign_leads` tables → Task 5 ✓
- Source-agnostic importer seam → Task 4 ✓
- (Deferred to Chunk 2/3, intentionally NOT here: campaign builder/routes/UI, `/campaigns`, scheduling/call-hours, dashboard reorientation, Segment-C persona wiring, `SmsProvider`.)

**Placeholder scan:** none — every code/test/command step is concrete.

**Type consistency:** `CallSegment` (`lib/segment.ts`) is reused by `offers.ts` (`OfferRoute.segment`) and `import.ts` (`LeadRow.call_segment`). `routeOffer` returns `{qualifies, primary_offer, secondary_offer, segment, reason}` and the test + `enrichOne` consume exactly those. `LeadInput.source` excludes `'scraped'` (only csv/manual import), while `LeadRow.source`/`leads.source` allows all three — consistent (scraped rows are written by the scraper, not the importer).

## Execution Handoff
Hand each task to a fresh subagent (recommended) or execute inline with checkpoints. Operator actions (npm install in Task 1, the migration apply in Task 5, any push) are called out in-step.
