# Website-audit verdict + manual segment override — Design

- **Date:** 2026-06-15
- **Status:** Approved (pending spec review)
- **Author:** pipeline work session

## Problem

The "improve_website" offer over-tags decent sites. Empirically (read-only DB
inspection, 2026-06-15):

- 166 real-website leads; **68 tagged `needs_improvement` (improve_website)**.
- **62 of 68 (91%) were flagged solely because the audit returned `unreachable`
  (score 0).** Only 6 were flagged for genuine quality issues (stale/slow/
  not-mobile/no-https combos, scores 35–45).

`unreachable` is over-trusted. The auditor does one headless-Chromium nav with
an 8s timeout and drops images; any timeout or `status >= 400` collapses to a
single `unreachable` issue (penalty 100, auto-flag). In practice that fires for
**alive but bot-protected sites** (Cloudflare/WAF 403s headless browsers),
**slow-but-fine sites** (8s timeout), and transient errors — none of which mean
"this site needs improvement." A decent site that blocks bots gets mislabeled.

Separately, the operator has no way to **correct** a misclassified lead: the
PATCH endpoint can set `primary_offer` (and locks via `offer_locked`) but cannot
set the **segment** itself, and the audit exposes no real status to explain
*why* a lead landed where it did.

## Goals

1. Replace blanket `unreachable` with a **real reachability verdict + HTTP
   status**, so only genuinely-dead sites count as an improve/build signal.
2. **Surface the status** on the lead ("403 blocked", "404", "timeout", "200")
   so the operator sees why.
3. Let the operator **manually set the segment** on the lead detail page and
   **lock** it against pipeline re-routing.
4. Backfill the existing 62 false positives (compute-only re-audit, no paid API).

## Non-goals

- Inline editing in the lead tables (detail page only).
- Perfect parked-domain / "domain for sale" detection (a 200 that's junk is the
  content audit's job; out of scope to fully solve here).
- Changing the content-quality heuristics (https/mobile/slow/stale) — they
  account for only 6 flags and aren't the reported problem.

---

## Part 1 — Audit by real verdict, not blanket "unreachable"

### Auditor changes (`web/lib/services/website-auditor.ts`)

**Try harder to load:**
- Raise `NAV_TIMEOUT_MS` 8s → **12s**; add **one retry** of the headless nav on
  a transient failure.
- On nav failure (timeout / blocked / error), **fall back to a plain Node
  `fetch()` GET** with a realistic UA, `redirect: "follow"`, a ~10s
  `AbortController` timeout. This lighter client frequently gets through
  bot-blocking that 403s headless Chromium, and at minimum returns the true
  HTTP status. Compute-only, no paid API.

**Classify by final verdict** and capture the status:

| Final result | `reachability` | `status` (string) | Verdict |
|---|---|---|---|
| 2xx, or redirect→2xx | `reachable` | `"200"` | Run the existing content audit (no_https / not_mobile / slow / stale) |
| 404 / 410 | `dead` | `"404"` | improve/build signal |
| DNS failure / connection refused | `dead` | `"dns_error"` / `"conn_refused"` | improve/build signal |
| persistent 5xx (after retry) | `dead` | `"500"` … | improve/build signal |
| 401 / 403 / 429 | `blocked` | `"403 blocked"` | **not** an improve signal |
| timeout / ambiguous after retry + fetch fallback | `unverified` | `"timeout"` | **not** an improve signal |

**New `WebsiteAudit` shape:**
```ts
export type Reachability = "reachable" | "dead" | "blocked" | "unverified";

export interface WebsiteAudit {
  score: number | null;            // null when blocked/unverified (not scored)
  issues: WebsiteIssue[];          // content issues only; `unreachable` removed
  needs_improvement: boolean | null; // null when blocked/unverified (unknown)
  reachability: Reachability;
  status: string;                  // "200" | "403 blocked" | "404" | "timeout" | ...
}
```

**Verdict rules:**
- `reachable` → `score = 100 − Σ penalties`; `needs_improvement = score <
  THRESHOLD || issues.includes("no_https")`.
- `dead` → `score = 0`, `needs_improvement = true`.
- `blocked` | `unverified` → `score = null`, `needs_improvement = null`,
  `issues = []` — **except** the static `diy_builder` signal (known from
  `website_kind` before any nav, e.g. a free Wix/Weebly/Carrd subdomain). If
  present it is kept: `issues = ['diy_builder']`, `needs_improvement = true`. A
  free-builder site is a legit improve target whether or not our bot can load
  it.
- The `unreachable` member of `WebsiteIssue` is **removed**; deadness is carried
  by `reachability`/`status`. `AUTO_FLAG_ISSUES` keeps only `no_https`.

### Segment/offer impact (`segment.ts`, `offers.ts`)
- `deriveSegment` already treats `needs_improvement == null` as healthy →
  `has_website`. So `blocked`/`unverified` leads default to the **discovery**
  segment (safe — we don't pitch "improve" on a site we couldn't inspect).
- `dead` → `needs_improvement = true` → `old_website` → improve pitch. Correct.
- No interface change to `routeOffer`/`deriveSegment` beyond accepting the
  existing nullable `needs_improvement`.

### Data model
- **Migration `033_lead_website_status.sql`:** `alter table leads add column if
  not exists website_status text;` (nullable). No other column needed
  (`website_score` already nullable int; `needs_improvement` already nullable
  bool).
- Stage-1 (`enrichOne`) and stage-2 persist `website_status = audit.status`
  alongside `website_score` / `website_issues` / `needs_improvement`.

### Backfill (`web/scripts/backfill-reaudit-unreachable.ts`, dry-run default)
- Select real-website leads with `needs_improvement = true` whose
  `website_issues` is exactly `['unreachable']` (the 62), **excluding
  `offer_locked = true`**.
- Re-audit each with the new auditor (concurrency-limited, mirrors stage-1's
  enrich pool), update `website_score`/`website_issues`/`needs_improvement`/
  `website_status` and re-derive `call_segment`/`primary_offer`.
- Compute-heavy (headless × ~62) but **no paid API**. `--apply` to write; prints
  before/after verdict counts.

---

## Part 2 — Manual segment override (lead detail page)

### Lock mechanism
- Reuse **`offer_locked`** (bool, default false). Stage-2 already skips all
  re-routing + re-audit when it's true ([stage-2-enrich.ts:210]). Add the same
  `if (!lead.offer_locked)` guard to **stage-1 `enrichOne`** (currently it
  re-routes unconditionally), so a locked lead survives a batch re-run.

### API (`PATCH /api/leads/:id`)
- Add `call_segment: z.enum(["no_website","old_website","has_website"]).optional()`.
- When `call_segment` is present, derive a consistent field set and lock:

| Segment | `primary_offer` | `secondary_offer` | `needs_improvement` | `offer_locked` |
|---|---|---|---|---|
| `no_website` | `build_website` | `voice_agent` | (unchanged) | `true` |
| `old_website` | `improve_website` | `voice_agent` | `true` | `true` |
| `has_website` | `null` | `voice_agent` | `false` | `true` |

- The segment→offer mapping lives in one helper in `offers.ts`
  (`offersForSegment(segment)`) reused by both `routeOffer` and the PATCH route —
  single source of truth, no drift.
- Keep the existing `primary_offer` override path working (still sets
  `offer_locked`).
- Add `offer_locked: z.boolean().optional()` to the PATCH body so the UI can
  **clear the lock** (`offer_locked:false`) and hand routing back to the
  pipeline. Setting `call_segment` or `primary_offer` still forces it `true`.

### UI (`web/app/(dashboard)/leads/[id]/page.tsx`)
- **Audit verdict row:** show `website_status` with plain-language context, e.g.
  "Site returned **403** — blocked, couldn't verify" / "**404** — dead" /
  "**200** — healthy (score 85)".
- **Segment control:** a client dropdown (`no_website` / `old_website` /
  `has_website`) defaulted to the current `call_segment`; on change it PATCHes
  and refreshes. A "Manual / locked" badge shows when `offer_locked` is true,
  with a way to clear the lock (PATCH `offer_locked:false`) to hand control back
  to the pipeline.
- Follow the existing client-action pattern already used on this page (e.g. the
  stage/notes editors) — dumb client component, calls the API route.

---

## Units & isolation

- **`website-auditor.ts`** — pure-ish I/O unit: URL → `WebsiteAudit`. Adds
  reachability + status; never throws. Independently unit-testable.
- **`offers.ts: offersForSegment()`** — pure mapping, shared by router + API.
- **PATCH route** — thin: validate → derive via helper → update → respond.
- **Segment dropdown** — dumb client component; one job: fire the PATCH.
- **Backfill script** — standalone tool; dry-run by default.

## Testing

- `web/scripts/check-auditor-verdict.ts` (assertion style, mirrors
  `check-niche.ts`): feed synthetic nav/fetch results for each row of the
  verdict table → assert `{reachability, status, needs_improvement}`. Mock the
  network layer (inject a fake fetch/nav result) so no live sites are hit.
- `web/scripts/check-segment-override.ts`: assert `offersForSegment()` mapping +
  derived `needs_improvement` for all three segments.
- Post-deploy: re-run `inspect-improve-flags.ts` to confirm the 62 drop out of
  the improve segment.
- `npm run typecheck` clean.

## Rollout

1. Migration 033 (additive, safe).
2. Auditor + offers/segment + API + UI changes.
3. Deploy (push to main = prod deploy — only on explicit go-ahead).
4. Run backfill `--apply` against the 62 once deployed.

## Risks / known limitations

- **`fetch()` fallback can mark a parked/"for sale" page as `reachable`.** It
  then goes through the content audit (thin/stale catches many) but not all.
  Acceptable — the operator can override, and it's strictly better than today.
- **Re-audit time:** ~62 headless loads in the backfill; concurrency-limited,
  minutes, compute-only.
- **`blocked` could hide a genuinely bad site** behind bot protection. By design
  it becomes "unverified → discovery segment" for the operator to eyeball,
  rather than a wrong auto-pitch.
