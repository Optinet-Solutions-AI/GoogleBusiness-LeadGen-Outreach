# Audit Reachability Verdict + Manual Segment Override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop tagging bot-blocked/timed-out-but-decent websites as `improve_website`, by classifying each site's real reachability + HTTP status; and let the operator manually set & lock a lead's segment from the lead detail page.

**Architecture:** The auditor gains two **pure** functions (`classifyReachability`, `buildVerdict`) that the network-touching `auditWebsite()` orchestrates after a "try harder" load (longer timeout + retry + plain-`fetch()` fallback). Reachability (`reachable|dead|blocked|unverified`) + an HTTP-status string are persisted on the lead; only `dead` or genuine content issues drive `needs_improvement`. A shared `offersForSegment()` helper backs both the auto-router and a new `call_segment` override on `PATCH /api/leads/:id`, locked via the existing `offer_locked` column.

**Tech Stack:** TypeScript, Next.js 14 (App Router), Supabase (Postgres), Playwright (headless audit), Vitest (unit tests), Zod (API validation).

---

## File Structure

**Create:**
- `db/migrations/033_lead_website_status.sql` — add `leads.website_status text`
- `web/lib/services/website-auditor.test.ts` — vitest for the pure verdict functions
- `web/app/(dashboard)/leads/[id]/SegmentOverride.tsx` — client dropdown to PATCH segment
- `web/scripts/backfill-reaudit-unreachable.ts` — re-audit the 62 false positives (dry-run default)

**Modify:**
- `web/lib/services/website-auditor.ts` — Reachability type, status, try-harder load, pure verdict fns, drop `unreachable` issue
- `web/lib/offers.ts` — add `offersForSegment()`, use it in `routeOffer`
- `web/lib/offers.test.ts` — add `offersForSegment` cases
- `web/lib/pipeline/stage-1-scrape.ts` — persist `website_status` on enriched rows
- `web/lib/pipeline/stage-2-enrich.ts` — persist `website_status`; pass nullable `needs_improvement` through
- `web/app/api/leads/[id]/route.ts` — PATCH accepts `call_segment` + `offer_locked`; derive offer fields
- `web/app/(dashboard)/leads/[id]/page.tsx` — render reachability/status verdict + mount `SegmentOverride`

**Deviation from spec (intentional):** the spec mentioned adding the `offer_locked` guard to stage-1's enrich path. Deferred — stage-1 does a **bulk upsert** whose key-union would null out routing columns for non-locked rows if we conditionally drop keys, and the only collision path (re-scraping a batch that already has operator-locked leads) is rare. The authoritative lock path (stage-2 / regenerate / build-lead) is already guarded. Tracked as a follow-up note in Task 5.

---

## Task 1: Migration 033 — `website_status` column

**Files:**
- Create: `db/migrations/033_lead_website_status.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 033_lead_website_status.sql
-- Stores the auditor's final reachability status string for an existing website,
-- e.g. "200", "404", "403 blocked", "timeout", "dns_error". null = not audited.
-- Lets the operator see WHY a lead was/wasn't tagged improve_website, and keeps
-- "couldn't verify" (blocked/timeout) distinct from "dead" (404/5xx/dns).
alter table leads add column if not exists website_status text;
```

- [ ] **Step 2: Apply the migration**

Run (from repo root):
```bash
psql "$SUPABASE_URL" -f db/migrations/033_lead_website_status.sql
```
Expected: `ALTER TABLE`. (If `psql` isn't wired to the pooled URL, apply via the Supabase SQL editor — paste the statement.)

- [ ] **Step 3: Verify the column exists**

Run (from `web/`):
```bash
npx tsx -e "import('dotenv').then(d=>d.config({path:'../.env'})).then(async()=>{const{getDb}=await import('@/lib/db');const{error}=await getDb().from('leads').select('website_status').limit(1);console.log(error?error.message:'website_status OK');})"
```
Expected: `website_status OK`

- [ ] **Step 4: Commit**

```bash
git add db/migrations/033_lead_website_status.sql
git commit -m "feat(db): add leads.website_status (033)"
```

---

## Task 2: Auditor pure verdict functions (TDD)

Add the reachability taxonomy and two pure, exported functions. No network here — this is the logic the I/O path will call. This task also changes the `WebsiteAudit` shape and removes the `unreachable` issue.

**Files:**
- Modify: `web/lib/services/website-auditor.ts`
- Test: `web/lib/services/website-auditor.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `web/lib/services/website-auditor.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { classifyReachability, buildVerdict } from "@/lib/services/website-auditor";

describe("classifyReachability", () => {
  it("2xx → reachable", () => {
    expect(classifyReachability({ kind: "http", statusCode: 200 })).toEqual({ reachability: "reachable", status: "200" });
  });
  it("3xx → reachable", () => {
    expect(classifyReachability({ kind: "http", statusCode: 301 })).toEqual({ reachability: "reachable", status: "301" });
  });
  it("404 → dead", () => {
    expect(classifyReachability({ kind: "http", statusCode: 404 })).toEqual({ reachability: "dead", status: "404" });
  });
  it("410 → dead", () => {
    expect(classifyReachability({ kind: "http", statusCode: 410 })).toEqual({ reachability: "dead", status: "410" });
  });
  it("500 → dead", () => {
    expect(classifyReachability({ kind: "http", statusCode: 503 })).toEqual({ reachability: "dead", status: "503" });
  });
  it("403 → blocked", () => {
    expect(classifyReachability({ kind: "http", statusCode: 403 })).toEqual({ reachability: "blocked", status: "403 blocked" });
  });
  it("429 → blocked", () => {
    expect(classifyReachability({ kind: "http", statusCode: 429 })).toEqual({ reachability: "blocked", status: "429 blocked" });
  });
  it("other 4xx (400) → unverified", () => {
    expect(classifyReachability({ kind: "http", statusCode: 400 })).toEqual({ reachability: "unverified", status: "400" });
  });
  it("timeout → unverified", () => {
    expect(classifyReachability({ kind: "error", error: "timeout" })).toEqual({ reachability: "unverified", status: "timeout" });
  });
  it("dns_error → dead", () => {
    expect(classifyReachability({ kind: "error", error: "dns_error" })).toEqual({ reachability: "dead", status: "dns_error" });
  });
  it("conn_refused → dead", () => {
    expect(classifyReachability({ kind: "error", error: "conn_refused" })).toEqual({ reachability: "dead", status: "conn_refused" });
  });
  it("unknown error → unverified", () => {
    expect(classifyReachability({ kind: "error", error: "unknown" })).toEqual({ reachability: "unverified", status: "error" });
  });
});

describe("buildVerdict", () => {
  it("reachable + no issues → healthy, score 100, not improve", () => {
    const v = buildVerdict({ reachability: "reachable", status: "200", contentIssues: [], isDiyBuilder: false });
    expect(v).toEqual({ score: 100, issues: [], needs_improvement: false, reachability: "reachable", status: "200" });
  });
  it("reachable + no_https → improve (auto-flag) even though score 75", () => {
    const v = buildVerdict({ reachability: "reachable", status: "200", contentIssues: ["no_https"], isDiyBuilder: false });
    expect(v.score).toBe(75);
    expect(v.needs_improvement).toBe(true);
  });
  it("reachable + two issues under threshold → improve", () => {
    const v = buildVerdict({ reachability: "reachable", status: "200", contentIssues: ["not_mobile", "diy_builder"], isDiyBuilder: true });
    expect(v.score).toBe(55);
    expect(v.needs_improvement).toBe(true);
  });
  it("dead → score 0, improve, no content issues", () => {
    const v = buildVerdict({ reachability: "dead", status: "404", contentIssues: [], isDiyBuilder: false });
    expect(v).toEqual({ score: 0, issues: [], needs_improvement: true, reachability: "dead", status: "404" });
  });
  it("blocked, not diy → unknown (null), score null, not improve", () => {
    const v = buildVerdict({ reachability: "blocked", status: "403 blocked", contentIssues: [], isDiyBuilder: false });
    expect(v).toEqual({ score: null, issues: [], needs_improvement: null, reachability: "blocked", status: "403 blocked" });
  });
  it("blocked + diy builder → still improve (free-builder is a known target)", () => {
    const v = buildVerdict({ reachability: "blocked", status: "403 blocked", contentIssues: [], isDiyBuilder: true });
    expect(v).toEqual({ score: null, issues: ["diy_builder"], needs_improvement: true, reachability: "blocked", status: "403 blocked" });
  });
  it("unverified, not diy → unknown", () => {
    const v = buildVerdict({ reachability: "unverified", status: "timeout", contentIssues: [], isDiyBuilder: false });
    expect(v.needs_improvement).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`):
```bash
npx vitest run lib/services/website-auditor.test.ts
```
Expected: FAIL — `classifyReachability`/`buildVerdict` are not exported.

- [ ] **Step 3: Edit the type + interface block**

In `web/lib/services/website-auditor.ts`, replace the `WebsiteIssue` union (remove `unreachable`) and the `ISSUE_PENALTY` map's `unreachable` line, and add the `Reachability` type. Replace lines 38–54 (the `WebsiteIssue` type + `ISSUE_PENALTY`) with:

```ts
export type WebsiteIssue =
  | "no_https"
  | "not_mobile"
  | "slow"
  | "stale_content"
  | "diy_builder";

export type Reachability = "reachable" | "dead" | "blocked" | "unverified";

/** Penalty each content issue subtracts from the 100-point health score. */
const ISSUE_PENALTY: Record<WebsiteIssue, number> = {
  no_https: 25,
  not_mobile: 25,
  slow: 15,
  stale_content: 15,
  diy_builder: 20,
};
```

- [ ] **Step 4: Update the `WebsiteAudit` interface**

Replace the `WebsiteAudit` interface (lines 67–71) with:
```ts
export interface WebsiteAudit {
  /** 0–100 content-health score. null when blocked/unverified (not scored). */
  score: number | null;
  /** Content issues only (https/mobile/slow/stale/diy). Never includes reachability. */
  issues: WebsiteIssue[];
  /** true = pitch improve; false = healthy; null = couldn't verify (unknown). */
  needs_improvement: boolean | null;
  reachability: Reachability;
  /** HTTP status code or error token, e.g. "200" | "404" | "403 blocked" | "timeout". */
  status: string;
}
```

- [ ] **Step 5: Replace the `verdict()` helper with the two pure functions**

Replace the `AUTO_FLAG_ISSUES` set + `verdict()` function (lines ~78–92) with:
```ts
/**
 * Issues that flag "needs improvement" on their own when the site is reachable,
 * regardless of score. http-only (−25) lands at 75, which wouldn't trip the
 * threshold otherwise, so it's promoted to an automatic flag.
 */
const AUTO_FLAG_ISSUES: ReadonlySet<WebsiteIssue> = new Set(["no_https"]);

export type ReachabilityInput =
  | { kind: "http"; statusCode: number }
  | { kind: "error"; error: "timeout" | "dns_error" | "conn_refused" | "unknown" };

/**
 * Map a raw HTTP status OR network-error kind to a reachability verdict + a
 * human status string. Only genuinely-dead results (404/410/5xx/dns/refused)
 * count as dead; bot-protection codes (401/403/429) are "blocked" (the site is
 * alive, we just can't inspect it); timeouts/ambiguous → "unverified".
 */
export function classifyReachability(input: ReachabilityInput): { reachability: Reachability; status: string } {
  if (input.kind === "error") {
    switch (input.error) {
      case "dns_error": return { reachability: "dead", status: "dns_error" };
      case "conn_refused": return { reachability: "dead", status: "conn_refused" };
      case "timeout": return { reachability: "unverified", status: "timeout" };
      default: return { reachability: "unverified", status: "error" };
    }
  }
  const code = input.statusCode;
  if (code >= 200 && code < 400) return { reachability: "reachable", status: String(code) };
  if (code === 404 || code === 410) return { reachability: "dead", status: String(code) };
  if (code >= 500) return { reachability: "dead", status: String(code) };
  if (code === 401 || code === 403 || code === 429) return { reachability: "blocked", status: `${code} blocked` };
  return { reachability: "unverified", status: String(code) };
}

/**
 * Combine a reachability verdict with the content issues (only gathered when
 * reachable) into the final WebsiteAudit. A free DIY-builder site is a known
 * improve target even when we couldn't load it, so it survives blocked/unverified.
 */
export function buildVerdict(args: {
  reachability: Reachability;
  status: string;
  contentIssues: WebsiteIssue[];
  isDiyBuilder: boolean;
}): WebsiteAudit {
  const { reachability, status, contentIssues, isDiyBuilder } = args;

  if (reachability === "reachable") {
    const penalty = contentIssues.reduce((sum, i) => sum + ISSUE_PENALTY[i], 0);
    const score = Math.max(0, 100 - penalty);
    const needs_improvement =
      score < NEEDS_IMPROVEMENT_THRESHOLD || contentIssues.some((i) => AUTO_FLAG_ISSUES.has(i));
    return { score, issues: contentIssues, needs_improvement, reachability, status };
  }

  if (reachability === "dead") {
    return { score: 0, issues: isDiyBuilder ? ["diy_builder"] : [], needs_improvement: true, reachability, status };
  }

  // blocked | unverified — couldn't inspect. Unknown unless it's a known free builder.
  return isDiyBuilder
    ? { score: null, issues: ["diy_builder"], needs_improvement: true, reachability, status }
    : { score: null, issues: [], needs_improvement: null, reachability, status };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `web/`):
```bash
npx vitest run lib/services/website-auditor.test.ts
```
Expected: PASS (all `classifyReachability` + `buildVerdict` cases). The `auditWebsite()` body still references the old `verdict()`/`issues.add("unreachable")` and will fail typecheck — fixed in Task 3, so do NOT run `tsc` yet.

- [ ] **Step 7: Commit**

```bash
git add web/lib/services/website-auditor.ts web/lib/services/website-auditor.test.ts
git commit -m "feat(pipeline): reachability verdict fns for website auditor"
```

---

## Task 3: Rewrite `auditWebsite()` I/O — try harder + fetch fallback

Wire the pure functions into the network path: longer timeout, one retry, and a plain-`fetch()` fallback that recovers bot-blocked sites and yields the true status.

**Files:**
- Modify: `web/lib/services/website-auditor.ts`

- [ ] **Step 1: Bump the timeout constant**

Change line ~27:
```ts
const NAV_TIMEOUT_MS = 12_000;
```
and line ~28:
```ts
const HARD_TIMEOUT_MS = 13_000;
```

- [ ] **Step 2: Add a fetch-fallback helper**

Add near the bottom of the file (above `newestYear`):
```ts
/**
 * Authoritative status check when the headless nav fails or returns >=400.
 * A plain fetch is a lighter client that often passes bot-protection that 403s
 * headless Chromium, and otherwise returns the real status. Compute-only.
 */
async function fetchStatus(url: string): Promise<ReachabilityInput> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": DESKTOP_UA, accept: "text/html,*/*" },
    });
    return { kind: "http", statusCode: res.status };
  } catch (err) {
    const msg = String(err).toLowerCase();
    if (msg.includes("abort") || msg.includes("timeout")) return { kind: "error", error: "timeout" };
    if (msg.includes("enotfound") || msg.includes("getaddrinfo") || msg.includes("dns")) return { kind: "error", error: "dns_error" };
    if (msg.includes("econnrefused") || msg.includes("refused")) return { kind: "error", error: "conn_refused" };
    return { kind: "error", error: "unknown" };
  } finally {
    clearTimeout(t);
  }
}
```

- [ ] **Step 3: Rewrite the `auditWebsite()` body**

Replace the whole `auditWebsite()` function (lines ~98–195) with:
```ts
export async function auditWebsite(url: string, opts: AuditOptions = {}): Promise<WebsiteAudit> {
  const isDiyBuilder = !!(opts.websiteKind && DIY_BUILDER_KINDS.has(opts.websiteKind));
  const contentIssues = new Set<WebsiteIssue>();
  if (isDiyBuilder) contentIssues.add("diy_builder");

  const startMs = Date.now();
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    const proxy = buildProxyOptions(opts.countryCode);
    context = await browser.newContext({
      userAgent: DESKTOP_UA,
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      ...(proxy ? { proxy } : {}),
      bypassCSP: true,
    });
    await context.route("**/*", (route: Route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      route.continue();
    });
    page = await context.newPage();

    // Try the headless nav twice (1 retry) before falling back to fetch.
    let nav: Awaited<ReturnType<Page["goto"]>> | null = null;
    for (let attempt = 0; attempt < 2 && !nav; attempt++) {
      nav = await Promise.race([
        page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), HARD_TIMEOUT_MS)),
      ]);
    }
    const loadMs = Date.now() - startMs;
    const headlessStatus = nav?.status() ?? 0;

    // Headless got a clean response → audit content from the rendered DOM.
    if (nav && headlessStatus >= 200 && headlessStatus < 400) {
      const finalUrl = page.url();
      if (!finalUrl.startsWith("https://")) contentIssues.add("no_https");
      if (loadMs > SLOW_LOAD_MS) contentIssues.add("slow");

      const hasViewport = await page.locator('meta[name="viewport"]').first().count().then((n) => n > 0).catch(() => false);
      if (!hasViewport) contentIssues.add("not_mobile");

      const metaDesc = await page.locator('meta[name="description"]').first().getAttribute("content").catch(() => null);
      const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";
      const copyrightYear = newestYear(bodyText);
      const currentYear = new Date().getFullYear();
      const thin = bodyText.trim().length < 400;
      const noDesc = !metaDesc || metaDesc.trim().length === 0;
      const oldCopyright = copyrightYear !== null && currentYear - copyrightYear > 2;
      if (thin || noDesc || oldCopyright) contentIssues.add("stale_content");

      const { reachability, status } = classifyReachability({ kind: "http", statusCode: headlessStatus });
      const result = buildVerdict({ reachability, status, contentIssues: [...contentIssues], isDiyBuilder });
      log.info({ url, status, loadMs, finalUrl, issues: result.issues, score: result.score }, "auditor.done");
      return result;
    }

    // Headless failed or returned >=400 (often bot-protection). Get the real
    // status with a lighter fetch client; trust it over the headless verdict.
    const probe = headlessStatus >= 400
      ? await fetchStatus(url)
      : await fetchStatus(url); // also covers nav===null (timeout/blocked)
    const { reachability, status } = classifyReachability(probe);
    // Reachable-via-fetch but no DOM to audit → no content issues, treat as healthy.
    const result = buildVerdict({ reachability, status, contentIssues: reachability === "reachable" ? [] : [...contentIssues], isDiyBuilder });
    log.info({ url, headlessStatus, probe, reachability, status }, "auditor.fallback");
    return result;
  } catch (err) {
    // Browser/setup blew up — last-resort fetch probe.
    const probe = await fetchStatus(url).catch(() => ({ kind: "error", error: "unknown" }) as ReachabilityInput);
    const { reachability, status } = classifyReachability(probe);
    log.warn({ url, err: String(err).slice(0, 200), durationMs: Date.now() - startMs }, "auditor.failed");
    return buildVerdict({ reachability, status, contentIssues: [...contentIssues], isDiyBuilder });
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
}
```

- [ ] **Step 4: Fix the file header docstring**

Replace lines 10–16 (the docstring paragraph about `unreachable`) with:
```ts
 * On a clean load we score content (https/mobile/speed/staleness). When the
 * headless nav fails or is bot-blocked, we fall back to a plain fetch to read
 * the true status, then classify: reachable | dead (404/410/5xx/dns) | blocked
 * (401/403/429) | unverified (timeout). Only `dead` or genuine content issues
 * flag needs_improvement; blocked/unverified are "couldn't verify" (null).
 *
 * Scoring: each content issue subtracts a penalty from 100; needs_improvement =
 * score < THRESHOLD, an auto-flag issue, or a dead verdict.
```

- [ ] **Step 5: Typecheck + re-run auditor tests**

Run (from `web/`):
```bash
npm run typecheck && npx vitest run lib/services/website-auditor.test.ts
```
Expected: typecheck clean; tests PASS.

- [ ] **Step 6: Live smoke (best-effort, network-dependent)**

Run (from `web/`):
```bash
npx tsx -e "import('@/lib/services/website-auditor').then(async m=>{for(const u of ['https://example.com','https://example.com/nope-404-xyz']){console.log(u, await m.auditWebsite(u));}})"
```
Expected: `example.com` → `reachability:'reachable'`; the 404 path → `reachability:'dead', status:'404'`. (Exact statuses vary by site; this is a sanity check, not a gate.)

- [ ] **Step 7: Commit**

```bash
git add web/lib/services/website-auditor.ts
git commit -m "feat(pipeline): try-harder load + fetch fallback in website auditor"
```

---

## Task 4: `offersForSegment()` helper + `routeOffer` refactor (TDD)

One source of truth for segment→offers, used by both the auto-router and the manual override.

**Files:**
- Modify: `web/lib/offers.ts`
- Test: `web/lib/offers.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `web/lib/offers.test.ts` (inside the file, after the existing `describe`):
```ts
import { offersForSegment } from "@/lib/offers";

describe("offersForSegment", () => {
  it("no_website → build_website + voice_agent", () => {
    expect(offersForSegment("no_website")).toEqual({ primary_offer: "build_website", secondary_offer: "voice_agent" });
  });
  it("old_website → improve_website + voice_agent", () => {
    expect(offersForSegment("old_website")).toEqual({ primary_offer: "improve_website", secondary_offer: "voice_agent" });
  });
  it("has_website → null primary + voice_agent", () => {
    expect(offersForSegment("has_website")).toEqual({ primary_offer: null, secondary_offer: "voice_agent" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `web/`):
```bash
npx vitest run lib/offers.test.ts
```
Expected: FAIL — `offersForSegment` not exported.

- [ ] **Step 3: Implement the helper + refactor `routeOffer`**

In `web/lib/offers.ts`, add after the `OfferRoute` interface:
```ts
/** Segment → offer pair. Single source of truth for both the auto-router and
 *  the manual-override PATCH route. */
export function offersForSegment(segment: CallSegment): {
  primary_offer: Offer | null;
  secondary_offer: Offer | null;
} {
  switch (segment) {
    case "no_website": return { primary_offer: "build_website", secondary_offer: "voice_agent" };
    case "old_website": return { primary_offer: "improve_website", secondary_offer: "voice_agent" };
    case "has_website": return { primary_offer: null, secondary_offer: "voice_agent" };
  }
}
```
Then replace the body of `routeOffer` with:
```ts
export function routeOffer(signals: OfferSignals): OfferRoute {
  const segment = deriveSegment(signals);
  const { primary_offer, secondary_offer } = offersForSegment(segment);
  return { qualifies: true, primary_offer, secondary_offer, segment, reason: null };
}
```
(Ensure `CallSegment` is imported — it already is via `import { deriveSegment, type CallSegment } from "./segment";`.)

- [ ] **Step 4: Run tests to verify they pass**

Run (from `web/`):
```bash
npx vitest run lib/offers.test.ts lib/segment.test.ts
```
Expected: PASS (new `offersForSegment` cases + existing `routeOffer` cases unchanged).

- [ ] **Step 5: Commit**

```bash
git add web/lib/offers.ts web/lib/offers.test.ts
git commit -m "refactor(pipeline): extract offersForSegment, reuse in routeOffer"
```

---

## Task 5: Persist `website_status` in stages 1 & 2

The auditor now returns `status`; persist it wherever we persist `website_score`.

**Files:**
- Modify: `web/lib/pipeline/stage-2-enrich.ts:216-230`
- Modify: `web/lib/pipeline/stage-1-scrape.ts:220-232`

- [ ] **Step 1: stage-2 — store status + nullable needs_improvement**

In `web/lib/pipeline/stage-2-enrich.ts`, inside the `if (hasWebsite && websiteUrl && lead.website_score == null)` audit block, add the status line after `offerFields.needs_improvement = audit.needs_improvement;`:
```ts
        offerFields.website_status = audit.status;
```

- [ ] **Step 2: stage-1 — store status in enrichOne**

In `web/lib/pipeline/stage-1-scrape.ts`, in `enrichOne`, inside the `try` that sets `row.website_score = audit.score;` etc., add:
```ts
      row.website_status = audit.status;
```
(`needs_improvement` is already assigned from `audit.needs_improvement`; it is now `boolean | null` — the DB column is nullable bool, so no further change.)

- [ ] **Step 3: Note the deferred stage-1 lock guard**

Add this comment above the `routeOffer` call in `stage-1-scrape.ts` `enrichOne` (documents the known limitation; no behavior change):
```ts
  // NOTE: stage-1 does NOT skip routing for offer_locked leads. The bulk upsert
  // can't conditionally omit columns without nulling them for other rows, and a
  // re-scrape over locked leads is rare. The lock IS honored by stage-2 /
  // regenerate / build-lead. Follow-up if batch re-scrapes become common.
```

- [ ] **Step 4: Typecheck**

Run (from `web/`):
```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib/pipeline/stage-1-scrape.ts web/lib/pipeline/stage-2-enrich.ts
git commit -m "feat(pipeline): persist website_status from auditor in stages 1 & 2"
```

---

## Task 6: PATCH `/api/leads/:id` — manual `call_segment` + lock control

**Files:**
- Modify: `web/app/api/leads/[id]/route.ts`

- [ ] **Step 1: Extend the Zod body**

Add to `PatchBody` (after the `primary_offer` field):
```ts
  // Operator override of the auto-routed SEGMENT. Derives the offer pair +
  // needs_improvement and locks the lead so the pipeline won't re-route it.
  call_segment: z.enum(["no_website", "old_website", "has_website"]).optional(),
  // Clear (false) hands routing back to the pipeline. Setting call_segment /
  // primary_offer forces this true regardless of what's sent here.
  offer_locked: z.boolean().optional(),
```

- [ ] **Step 2: Derive offer fields from the segment + lock**

In the `PATCH` handler, replace the block:
```ts
  // A manual offer pick is an override — lock it so the router won't reset it.
  if ("primary_offer" in payload) payload.offer_locked = true;
```
with:
```ts
  // A manual SEGMENT pick derives the offer pair + needs_improvement, and locks.
  if (typeof payload.call_segment === "string") {
    const segment = payload.call_segment as "no_website" | "old_website" | "has_website";
    const { primary_offer, secondary_offer } = offersForSegment(segment);
    payload.primary_offer = primary_offer;
    payload.secondary_offer = secondary_offer;
    if (segment === "old_website") payload.needs_improvement = true;
    else if (segment === "has_website") payload.needs_improvement = false;
    payload.offer_locked = true;
  }
  // A manual offer pick is also an override — lock it.
  if ("primary_offer" in payload && payload.call_segment === undefined) payload.offer_locked = true;
```

- [ ] **Step 3: Import the helper**

Add to the imports at the top of the file:
```ts
import { offersForSegment } from "@/lib/offers";
```

- [ ] **Step 4: Typecheck**

Run (from `web/`):
```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 5: Manual verification (one lead, no paid API — DB write only)**

Start the dev server (`npm run dev`), then in another shell:
```bash
# Pick any real-website lead id from the dashboard, then:
curl -s -X PATCH http://localhost:3000/api/leads/<LEAD_ID> -H "content-type: application/json" -d '{"call_segment":"has_website"}'
```
Expected: `{"success":true,"data":{"id":"<LEAD_ID>","updated":{"call_segment":"has_website","primary_offer":null,"secondary_offer":"voice_agent","needs_improvement":false,"offer_locked":true}}}`

- [ ] **Step 6: Commit**

```bash
git add web/app/api/leads/[id]/route.ts
git commit -m "feat(api): manual call_segment override + lock control on PATCH /leads/:id"
```

---

## Task 7: Lead detail UI — verdict/status display + segment dropdown

**Files:**
- Create: `web/app/(dashboard)/leads/[id]/SegmentOverride.tsx`
- Modify: `web/app/(dashboard)/leads/[id]/page.tsx`

- [ ] **Step 1: Confirm the page's Lead type carries the fields**

In `web/app/(dashboard)/leads/[id]/page.tsx`, ensure the `Lead` type and the Supabase `.select(...)` (around line 88) include: `call_segment`, `primary_offer`, `needs_improvement`, `website_score`, `website_status`, `website_kind`, `offer_locked`, `has_website`. Add any missing names to BOTH the type and the select string. (The select currently lists `category,rating,review_count,has_website,phone,website_url,website_kind,...` — append the missing ones.)

- [ ] **Step 2: Create the client override component**

Create `web/app/(dashboard)/leads/[id]/SegmentOverride.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SEGMENTS = [
  { value: "no_website", label: "No website → Build" },
  { value: "old_website", label: "Old/weak website → Improve" },
  { value: "has_website", label: "Healthy website → Discovery" },
] as const;

export function SegmentOverride({
  leadId,
  segment,
  locked,
}: {
  leadId: string;
  segment: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(segment ?? "has_website");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "update failed");
      router.refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="text-[13px] border border-rule rounded px-2 py-1 bg-surface"
        value={value}
        disabled={busy}
        onChange={(e) => {
          setValue(e.target.value);
          patch({ call_segment: e.target.value });
        }}
      >
        {SEGMENTS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      {locked && (
        <button
          className="text-[11px] text-ink-subtle underline disabled:opacity-50"
          disabled={busy}
          onClick={() => patch({ offer_locked: false })}
          title="Clear the manual lock and let the pipeline re-route"
        >
          Manual · clear lock
        </button>
      )}
      {err && <span className="text-[11px] text-urgent">{err}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Render the verdict + dropdown on the page**

In `web/app/(dashboard)/leads/[id]/page.tsx`, import the component at the top:
```tsx
import { SegmentOverride } from "./SegmentOverride";
```
Then in the info grid (just after the `Category` `InfoRow` at line ~248), add a website-verdict row + the override. Insert:
```tsx
      </div>

      <div className="py-4 border-b border-rule space-y-2">
        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-[0.14em] font-mono">Website verdict</div>
        <div className="text-[13px] text-ink">{websiteVerdictLabel(lead)}</div>
        <SegmentOverride leadId={lead.id} segment={lead.call_segment} locked={!!lead.offer_locked} />
```
(The existing `</div>` that closed the grid moves to before this new block — i.e. close the 2-col grid first, then open this section. Match the surrounding JSX nesting.)

- [ ] **Step 4: Add the verdict-label helper**

At the bottom of `page.tsx` (with the other module-scope helpers like `InfoRow`), add:
```tsx
function websiteVerdictLabel(lead: Lead): string {
  if (lead.has_website === false) return "No real website — Build segment";
  const status = lead.website_status;
  if (!status) return "Not audited yet";
  if (status.includes("blocked")) return `Site returned ${status} — alive but we couldn't inspect it (verify manually)`;
  if (status === "timeout") return "Site timed out — couldn't verify (verify manually)";
  if (status === "404" || status === "410") return `Site is dead (${status}) — Improve/Build`;
  if (status === "dns_error" || status === "conn_refused") return `Domain doesn't resolve (${status}) — Improve/Build`;
  if (Number(status) >= 500) return `Server error (${status}) — Improve/Build`;
  const score = lead.website_score;
  return lead.needs_improvement
    ? `Reachable (${status}) but weak${score != null ? `, score ${score}` : ""} — Improve`
    : `Reachable (${status}), healthy${score != null ? `, score ${score}` : ""} — Discovery`;
}
```
(Ensure the `Lead` type includes `website_status: string | null`, `website_score: number | null`, `needs_improvement: boolean | null`, `call_segment: string | null`, `offer_locked: boolean | null`, `has_website: boolean | null` — add any missing from Step 1.)

- [ ] **Step 5: Typecheck + build**

Run (from `web/`):
```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 6: Manual verification**

`npm run dev`, open `/leads/<id>` for a previously-`unreachable` lead. Confirm the verdict line renders and changing the dropdown updates the lead (page refreshes, "Manual · clear lock" appears). Clearing the lock removes the badge.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(dashboard)/leads/[id]/SegmentOverride.tsx" "web/app/(dashboard)/leads/[id]/page.tsx"
git commit -m "feat(web): website verdict + manual segment override on lead detail page"
```

---

## Task 8: Backfill — re-audit the 62 false positives

**Files:**
- Create: `web/scripts/backfill-reaudit-unreachable.ts`

- [ ] **Step 1: Write the backfill script (dry-run default)**

Create `web/scripts/backfill-reaudit-unreachable.ts`:
```ts
/**
 * backfill-reaudit-unreachable.ts — Re-audit leads previously flagged
 * improve_website solely because the old auditor returned `unreachable`.
 *
 * Usage (from web/):
 *   npx tsx scripts/backfill-reaudit-unreachable.ts          # dry-run
 *   npx tsx scripts/backfill-reaudit-unreachable.ts --apply  # write
 *
 * Compute-only (headless audits) — NO paid API. Skips offer_locked leads.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { getDb } from "@/lib/db";
import { auditWebsite } from "@/lib/services/website-auditor";
import { routeOffer } from "@/lib/offers";
import type { WebsiteKind } from "@/lib/services/types";

const CONCURRENCY = 4;

interface Row {
  id: string; business_name: string | null; website_url: string | null;
  website_kind: WebsiteKind | null; website_issues: string[] | null;
  offer_locked: boolean | null; batch_id: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();

  const { data, error } = await db
    .from("leads")
    .select("id,business_name,website_url,website_kind,website_issues,offer_locked,batch_id")
    .eq("has_website", true)
    .eq("needs_improvement", true);
  if (error) throw new Error(error.message);

  const candidates = (data ?? []).filter(
    (r: Row) =>
      !r.offer_locked &&
      !!r.website_url &&
      Array.isArray(r.website_issues) &&
      r.website_issues.length === 1 &&
      r.website_issues[0] === "unreachable",
  ) as Row[];

  console.log(`Candidates (unreachable-only, unlocked): ${candidates.length}`);

  const country = new Map<string, string>();
  const batchIds = [...new Set(candidates.map((c) => c.batch_id).filter(Boolean))] as string[];
  if (batchIds.length) {
    const { data: batches } = await db.from("batches").select("id,country_code").in("id", batchIds);
    for (const b of batches ?? []) country.set(b.id, b.country_code ?? "us");
  }

  let cleared = 0, stillImprove = 0, idx = 0;
  const queue = [...candidates];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      const n = ++idx;
      try {
        const audit = await auditWebsite(r.website_url!, {
          websiteKind: r.website_kind,
          countryCode: r.batch_id ? country.get(r.batch_id) ?? null : null,
        });
        const route = routeOffer({ has_website: true, needs_improvement: audit.needs_improvement });
        const before = "improve";
        const after = audit.needs_improvement === true ? "improve" : audit.needs_improvement === null ? "unverified" : "healthy";
        if (after === "improve") stillImprove++; else cleared++;
        console.log(`  [${n}/${candidates.length}] ${after.padEnd(10)} ${audit.status.padEnd(12)} ${r.business_name} — ${r.website_url}`);
        if (apply) {
          const { error: uErr } = await db.from("leads").update({
            website_score: audit.score,
            website_issues: audit.issues,
            needs_improvement: audit.needs_improvement,
            website_status: audit.status,
            call_segment: route.segment,
            primary_offer: route.primary_offer,
            secondary_offer: route.secondary_offer,
          }).eq("id", r.id);
          if (uErr) console.error(`     update failed: ${uErr.message}`);
        }
      } catch (e) {
        console.error(`  [${n}] audit failed for ${r.website_url}: ${String(e).slice(0, 160)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  console.log(`\nWould clear from improve: ${cleared}   still improve: ${stillImprove}`);
  if (!apply) console.log("Dry-run only. Re-run with --apply to write.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run (from `web/`):
```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 3: Dry-run (after deploy of the auditor changes; compute-only)**

Run (from `web/`):
```bash
npx tsx scripts/backfill-reaudit-unreachable.ts
```
Expected: prints ~62 candidates, each with a new verdict (`healthy` / `unverified` / `improve`) and status. No DB writes.

- [ ] **Step 4: Commit**

```bash
git add web/scripts/backfill-reaudit-unreachable.ts
git commit -m "feat(pipeline): backfill script to re-audit unreachable-only leads"
```

---

## Task 9: Final verification & rollout

- [ ] **Step 1: Full check**

Run (from `web/`):
```bash
npm run typecheck && npm test
```
Expected: typecheck clean; all vitest suites pass (auditor, offers, segment).

- [ ] **Step 2: Deploy** (only on explicit operator go-ahead — push to main = prod deploy)

```bash
git checkout main && git merge --no-ff feat/audit-verdict-manual-segment
# then push only when told
```

- [ ] **Step 3: Apply the backfill** (post-deploy, operator go-ahead)

```bash
npx tsx scripts/backfill-reaudit-unreachable.ts --apply
```

- [ ] **Step 4: Confirm the fix**

Run (from `web/`):
```bash
npx tsx scripts/inspect-improve-flags.ts
```
Expected: the `unreachable` row is gone; `Tagged needs_improvement` drops by roughly the number the backfill cleared.

---

## Self-Review notes

- **Spec coverage:** try-harder load (T3) ✓, real status taxonomy (T2) ✓, status surfaced in UI (T7) ✓, blocked/unverified ≠ improve (T2) ✓, diy-builder survives blocked (T2 test) ✓, manual segment + lock (T6) ✓, lead-detail surface (T7) ✓, migration 033 (T1) ✓, backfill (T8) ✓. Stage-1 lock guard intentionally deferred (documented, T5).
- **Type consistency:** `WebsiteAudit.score: number|null`, `needs_improvement: boolean|null`, `status: string`, `reachability: Reachability` used identically across T2/T3/T5/T8; `offersForSegment` signature identical in T4/T6; `Reachability`/`ReachabilityInput` exported in T2 and consumed in T3/backfill.
