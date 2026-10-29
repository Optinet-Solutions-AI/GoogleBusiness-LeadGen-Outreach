# Liquidation Leads (slice 1: WARN closures) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free "WARN closures" lead source to the batch pipeline so an operator can pull US businesses that have announced closures/layoffs, enrich them, and send a buy-inventory email — without touching how Google-Maps batches behave.

**Architecture:** A fourth scraper value `warn` flows through the existing batch → stage-1 → leads path. `lib/services/warn-feed.ts` maps WARN Feed notices into the existing `NormalizedLead` shape (synthetic `place_id = warn:<id>` for the upsert) plus a `signal` block that stage 1 writes to four new lead columns. Qualification, segment/offer routing, enrichment and the lead UI get a source-aware branch keyed on `signal_type`; everything else is unchanged.

**Tech Stack:** Next.js 14 App Router, TypeScript, zod, Supabase (Postgres), vitest. WARN Feed (CC BY 4.0, no key). Google CSE (optional, already in config) for website discovery.

**Spec:** `docs/superpowers/specs/2026-10-29-liquidation-leads-design.md`

## Global Constraints

- CLAUDE.md rules: 4-line file header docstring; thin routes (`withApi`, zod, `ok`/`fail`); `import "@/lib/server-guard"` on DB/secret modules; client components import nothing server-guarded; typecheck + lint + `npm test` clean before every commit; Conventional Commits; every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Migration **049**, additive + idempotent, mirrored in `db/schema.sql`; `leads.stage` untouched; API envelope unchanged.
- Scraper value `warn`; batch `niche` ∈ {`closures`, `closures_layoffs`}; batch `city` = 2-letter state or `US`; `settings` jsonb `{ window_days: 90, min_employees: 10 }` defaults; cap `WARN_MAX_PER_QUERY = 500`; cost $0.
- Lead columns: `signal_type` ∈ {`closure`,`layoff`,`bankruptcy`,`listing`}, `signal_date`, `signal_source_url`, `signal_meta`. Segment `liquidation`; offer `buy_inventory` (label "Buy remaining inventory").
- Signal leads: `business_status = "OPERATIONAL"` always; never Build / never the screenshot sequence; email only via the normal verification-gated SMTP path.
- No paid calls by default: WARN Feed and the contact-page crawl are free; CSE only when configured; Hunter never in this slice. Attribution "Source: WARN Feed, CC BY 4.0" wherever the source is shown.
- Google-Maps batches: zero behaviour change (existing tests stay green and are extended with "unchanged" cases).

## Review Focus

1. The same employer appears many times (store numbers, re-notices): outreach must not email one HQ ten times → stage 1 keeps the earliest-effective notice per `company_canonical` within a batch and rejects the rest as `duplicate_company` (Task 5 test).
2. All-states run streams ~19 MB NDJSON: must filter line-by-line, stop at `limit`, and never buffer the whole file (Task 4 test with a streamed fixture).
3. Notices with empty `employees_affected` or empty `effective_date`: kept only when `min_employees = 0`; a missing effective date falls back to `notice_date` (Task 4 test).
4. Feed outage / non-200: the batch ends `failed` with `last_error` naming the source; no partial half-batch marked `done` (Task 5 test on the thrown error path).
5. A closure whose effective date already passed > 30 days ago is stale → rejected `stale_signal`, still persisted with the reason (Task 3 test).

---

### Task 1: Migration 049, types, pricing, zod

**Files:**
- Create: `db/migrations/049_liquidation_leads.sql` · Modify: `db/schema.sql`, `web/lib/pricing.ts`, `web/lib/services/types.ts`, `web/app/api/batches/route.ts`, `web/app/api/pricing/estimate/route.ts`, `web/lib/pipeline/orchestrator.ts` (store `settings`)
- Test: `web/lib/pricing.test.ts` (extend or create)

**Interfaces:**
- Produces: `Scraper = "apify" | "google_places" | "outscraper" | "warn"`; `WARN_MAX_PER_QUERY = 500`; `estimate("warn", n)` → `{ cost_usd: 0, truncated_limit: min(n, 500), ... }` same shape as the others; `estimateAll` includes `warn`.
- Produces: `NormalizedLead.signal?: { type: "closure" | "layoff" | "bankruptcy" | "listing"; date: string | null; source_url: string; meta: Record<string, unknown> }`.
- Produces: `BatchSettingsSchema = z.object({ window_days: z.number().int().min(1).max(365).default(90), min_employees: z.number().int().min(0).max(100000).default(10) })` exported from `web/lib/batch-settings.ts` (pure); POST `/api/batches` accepts `settings` (optional) and `scraper: "warn"`; `createBatch` persists it.
- Migration: `alter table batches drop constraint if exists batches_scraper_check; add constraint … check (scraper in ('apify','outscraper','google_places','warn'))`; `alter table batches add column if not exists settings jsonb not null default '{}'::jsonb`; `alter table leads add column if not exists signal_type text check (signal_type in ('closure','layoff','bankruptcy','listing'))`, `signal_date date`, `signal_source_url text`, `signal_meta jsonb`; extend `call_segment` check with `'liquidation'` and `primary_offer`/`secondary_offer` checks with `'buy_inventory'` (drop + re-add by name, as 023 does).

- [ ] **Step 1: Write failing tests** — `estimate("warn", 600)` returns cost 0 and `truncated_limit` 500; `estimateAll(100).warn.cost_usd === 0`; `BatchSettingsSchema.parse({})` yields the defaults; `parse({ window_days: 0 })` throws.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(db): liquidation lead signal columns, warn scraper, batch settings`

---

### Task 2: Segment + offer routing

**Files:** Modify `web/lib/segment.ts`, `web/lib/offers.ts`, `web/lib/lead-offer.ts` (if it switches on segment) · Test: `web/lib/segment.test.ts`, `web/lib/offers.test.ts`

**Interfaces:** `CALL_SEGMENTS` gains `"liquidation"`; `OFFERS` gains `"buy_inventory"`; `OFFER_LABEL.buy_inventory = "Buy remaining inventory"`; `offersForSegment("liquidation")` → `["buy_inventory"]`; `deriveSegment(signals)` returns `"liquidation"` when `signals.signal_type` is set (new optional field); `routeOffer` follows.

- [ ] **Step 1: Failing tests** — `deriveSegment({ has_website: false, needs_improvement: false, signal_type: "closure" }) === "liquidation"`; `routeOffer(...)` → `{ call_segment: "liquidation", primary_offer: "buy_inventory", secondary_offer: null }`; every existing case unchanged (keep the old tests).
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(pipeline): liquidation segment and buy-inventory offer`

---

### Task 3: Source-aware qualification

**Files:** Modify `web/lib/filters.ts` · Test: `web/lib/filters.test.ts`

**Interfaces:** `qualifies(lead: RawLead & { signal_type?: string | null; signal_date?: string | null; signal_meta?: { employees_affected?: number | null } | null }, opts?: { minEmployees?: number; now?: Date })` → `{ ok: true } | { ok: false; reason }`. New reasons `stale_signal` (signal_date more than 30 days before `now`) and `below_min_employees`; labels in `REJECTION_REASON_LABEL`. For signal leads the rating / review / phone / closed-permanently gates are skipped.

- [ ] **Step 1: Failing tests** — signal lead with no phone/rating/reviews qualifies; `signal_date` 45 days ago → `stale_signal`; `employees_affected 4` with `minEmployees 10` → `below_min_employees`; a Google lead with no phone is still `no_phone`; `CLOSED_PERMANENTLY` Google lead still rejected.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(pipeline): qualify closure-signal leads without Google metrics`

---

### Task 4: WARN Feed service

**Files:** Create `web/lib/services/warn-feed.ts` · Test: `web/lib/services/warn-feed.test.ts` + fixtures `web/lib/services/__fixtures__/warn-{tx.csv,sample.ndjson}`

**Interfaces:**
- `WARN_BASE = "https://approjects-warn-act-notices.static.hf.space"`; per-state `GET ${WARN_BASE}/data/by-state/<st>.csv`; all states `GET ${WARN_BASE}/data/warn_notices.ndjson` (follow redirects).
- `export type WarnNotice = { id; state; company; company_canonical; company_dba; location; employees_affected: number | null; notice_date: string | null; effective_date: string | null; notice_type: string; first_seen: string }`.
- Pure, exported: `isClosure(noticeType: string): boolean` (`/clos|shut|cease|permanent/i`); `inWindow(n: WarnNotice, windowDays: number, now: Date): boolean` (uses `effective_date ?? notice_date`); `toNormalizedLead(n: WarnNotice): NormalizedLead` (mapping per the spec: `business_name = company_dba || company_canonical || company`, `address = "<location>, <state>"`, `category = notice_type`, `business_status "OPERATIONAL"`, `has_website false`, `website_kind "none"`, `place_id = "warn:" + id`, `signal = { type: isClosure ? "closure" : "layoff", date: effective_date ?? notice_date, source_url: WARN_BASE + "/data/by-state/" + state.toLowerCase() + ".csv", meta: { warn_id, state, location, notice_type, notice_date, employees_affected, company_raw: company, company_canonical } }`).
- `export async function fetchWarnNotices(input: { state: string; signal: "closures" | "closures_layoffs"; windowDays: number; minEmployees: number; limit: number; now?: Date }): Promise<NormalizedLead[]>` — CSV path for a state, line-by-line NDJSON stream for `US`, stops at `limit`, `withRetry` on fetch, pino log per fetch with status + count; throws `WarnFeedError` on non-200.

- [ ] **Step 1: Failing tests** — `isClosure("Plant Closing")` true, `isClosure("Layoff")` false; `toNormalizedLead` of the fixture's closure row yields the exact fields above; `fetchWarnNotices` (fetch mocked to serve the fixtures) returns only closures inside 90 days with ≥ 10 employees, honours `limit`, and the NDJSON path never calls `.json()` on the whole body (assert the stream reader is used); a 503 → `WarnFeedError`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(services): warn feed closure/layoff notices as normalized leads`

---

### Task 5: Stage 1 wiring + dedupe

**Files:** Modify `web/lib/pipeline/stage-1-scrape.ts` (dispatch, `baseRow`, skip audit/logo/photos for signal leads, `duplicate_company` dedupe), `web/lib/pipeline/orchestrator.ts` (pass `settings`) · Test: `web/lib/pipeline/stage-1-scrape.test.ts` (pure helpers extracted: `rowFromNormalized`, `dedupeByCompany`)

**Interfaces:** `scraper === "warn"` → `fetchWarnNotices({ state: batch.city, signal: batch.niche, windowDays, minEmployees, limit })`; `baseRow` writes `signal_type/date/source_url/meta` from `lead.signal`; `routeOffer` receives `signal_type`; `qualifies(lead, { minEmployees })`; `dedupeByCompany(leads)` keeps the earliest `signal.date` per `signal.meta.company_canonical` and marks the rest `{ qualified: false, rejection_reason: "duplicate_company" }`; no `auditWebsite`, `resolveLogo`, `getPlacePhotos` for signal leads. A thrown `WarnFeedError` ends the batch `failed` with `last_error`.

- [ ] **Step 1: Failing tests** — `rowFromNormalized` maps the signal block to the four columns; `dedupeByCompany` keeps one per canonical name (earliest date) and labels the others; an apify-shaped lead passes through both helpers unchanged.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Manual (free):** `npm run run:batch -- --niche=closures --city=TX --scraper=warn --limit=50` → leads at `scraped` with signal columns; run it again → zero new rows (upsert on `warn:<id>`); check one `duplicate_company` row exists if the feed had re-notices.
- [ ] **Step 6: Commit** `feat(pipeline): run warn closure batches through stage 1`

---

### Task 6: Enrichment for signal leads

**Files:** Modify `web/lib/pipeline/stage-2-enrich.ts`, `web/lib/services/social-search.ts` (or create `web/lib/services/company-website.ts`), `web/lib/services/website-email.ts` (phone extraction) · Test: `web/lib/services/company-website.test.ts`, `web/lib/services/website-email.test.ts`

**Interfaces:** `findCompanyWebsite({ name, state }): Promise<string | null>` — Google CSE query `"<name>" <state> official site`, first result whose host is not in `AGGREGATOR_HOSTS` (linkedin, facebook, instagram, yelp, bbb.org, mapquest, zoominfo, dnb, glassdoor, indeed, crunchbase, wikipedia, warnindex, bloomberg); returns null when CSE is unconfigured (graceful no-op, logged once). `extractUsPhone(html: string): string | null` (pure; `(xxx) xxx-xxxx`, `xxx-xxx-xxxx`, `xxx.xxx.xxxx`, `+1 …`). Stage 2 for `signal_type` leads: website via `findCompanyWebsite` → fallback `findSocialUrl`; then the existing email crawl, and `phone` from `extractUsPhone` when the lead has none; skip logo / brand colour / audit / photos; `routeOffer` keeps `liquidation`.

- [ ] **Step 1: Failing tests** — `extractUsPhone` on four formats + a non-phone number string → null; `findCompanyWebsite` with a mocked CSE response skips an aggregator and returns the first real host; unconfigured CSE → null without throwing.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Manual:** enrich one TX lead (`POST /api/leads/:id/regenerate` from stage 2 or the CLI path) and confirm `website_url` / `email` / `phone` land when the site has them.
- [ ] **Step 6: Commit** `feat(pipeline): find a closing company's website, email and phone`

---

### Task 7: Buy-inventory email + guards

**Files:** Modify `web/lib/pipeline/stage-5-email.ts` (template by `primary_offer`), `web/lib/pipeline/build-gate.ts` (refuse Build for signal leads), `web/app/api/leads/[id]/sequence/route.ts` (refuse enroll for signal leads) · Test: `web/lib/pipeline/stage-5-email.test.ts`, `web/lib/pipeline/build-gate.test.ts`

**Interfaces:** `renderBuyInventoryEmail(lead, sender): { subject: string; text: string }` — plain text, ≤ 120 words, no links/images, mentions the city/state and "closing location", one question, the standard opt-out line; chosen when `lead.primary_offer === "buy_inventory"`. `buildGate(lead)` returns `{ ok: false, reason: "liquidation leads have no demo site" }` for signal leads; sequence `enroll` → 400 `"not available for liquidation leads"`.

- [ ] **Step 1: Failing tests** — template renders with the expected subject and ≤ 120 words and no `http`; a `build_website` lead still gets the existing template; `buildGate` refuses a signal lead and still accepts a no_website Google lead; enroll route test (if the route has tests) returns 400.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(pipeline): buy-inventory cold email and demo-site guards for signal leads`

---

### Task 8: Dashboard — batch form, badges, leads table, lead detail

**Files:** Modify `web/components/NewBatchModal.tsx`, `web/components/ScraperBadge.tsx`, `web/components/BatchesTable.tsx`, the leads table component and lead detail page under `web/app/(dashboard)/leads/…` (find the components that render Build / Enroll / demo panel) · Create: `web/lib/data/us-states.ts` (pure list)

**Interfaces:** NewBatchModal: fourth `ScraperButton` "WARN closures" (caption "Free · WARN Feed, CC BY 4.0"); when selected, city → `<select>` of `US_STATES` + "All US" (value `US`), niche → toggle `closures` / `closures_layoffs`, plus `window_days` and `min_employees` inputs; estimate call unchanged (`scraper=warn` → $0); submit includes `settings`. Leads table: a "Signal" column (closure/layoff · effective date · staff) shown when any row has `signal_type`, plus a filter. Lead detail for signal leads: a line "Closure · effective <date> · <n> staff · Source: WARN Feed ↗"; Build, Enroll and the demo-site panel hidden; "Email (inventory offer)" and the call-campaign add visible.

- [ ] **Step 1:** Implement. **Step 2: Verify** on the dev server: create a `warn` batch for `TX` from the modal (free) → batch row shows the badge → leads table shows the Signal column → open a lead → Build/Enroll hidden, email button present; screenshot `…/scratchpad/warn-batch.png`; no console errors. **Commit** `feat(web): warn closures batch form, signal column and liquidation lead view`

---

### Task 9: Docs + acceptance

**Files:** Create `workflows/run_liquidation_batch.md` · Modify `CLAUDE.md` (scraper list, env note "no new vars", migration 049, lead columns, offer strategy row for `liquidation → buy_inventory`, API body `settings`), `docs/status/2026-W44.md` (new dated block, non-technical)

- [ ] **Step 1: Acceptance (free):** from the dashboard run `WARN closures · TX · closures · 90 days · ≥ 10 staff · limit 100` → record counts (scraped / qualified / stale / duplicate), enrich 5 leads → record how many got a website / email / phone; prepare (do not send) one buy-inventory email and paste its text into the report. Then one Google-Maps batch created in the modal must look identical to before (no send, no paid run — just the form + estimate).
- [ ] **Step 2:** Write the SOP + CLAUDE.md + status block. **Step 3:** typecheck/lint/test clean. **Commit** `docs(docs): liquidation leads workflow, claude.md and status`
