# Review-site sources (Trustpilot + TripAdvisor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New batch sources **Trustpilot** and **TripAdvisor** that find low-rated businesses through Apify robots and
turn them into leads pitched **reputation management** (OptiRate). Yelp is deferred (no robot returned real data).

**Architecture:** Same pattern as the exhibitor source: new `batches.scraper` values, a provider file per site under
`web/lib/services/`, stage 1 maps robot rows to `NormalizedLead` with `signal.type = "review_site"`, routing gives
segment `reputation` / offer `reputation_mgmt`, Send email gets a matching template and an OptiRate default sender.

**Tech Stack:** Next.js 14 / TypeScript, Supabase, Apify REST API, vitest (run from `web/`; on Windows run vitest from
an upper-case `C:\` cwd — a lower-case `c:\` cwd makes every suite fail with "reading 'config'").

**Spec:** `docs/superpowers/specs/2026-11-19-review-site-sources-design.md` (read it, especially "Robot test runs" and
"Answers to the builder check").

## Global Constraints

- Robots: Trustpilot `scrapersdelight~trustpilot-business-leads-scraper`; TripAdvisor `clearpath~tripadvisor-scraper`.
  Never `rbbscrap~yelp-scraper` (returns fabricated data). No Yelp in this plan.
- Every robot run passes `maxTotalChargeUsd` (= the batch's estimated scrape cost × 1.5, min $0.05) so a run can't overspend.
- Rating range inclusive: keep `min_rating ≤ rating ≤ max_rating` and `review_count ≥ min_reviews`; defaults 1.0 / 3.5 / 5.
- `limit` = kept leads wanted; ask the robot for `min(limit × 3, 300)`.
- Review-site leads: never built, never in the screenshot sequence or demo campaigns, **AI calls blocked**, emailed only
  through Send email; secondary offer null.
- `place_id` = `` `${platform}:${pathname}` `` of the profile URL (e.g. `trustpilot:/review/jdbyrider.com`,
  `tripadvisor:/Restaurant_Review-g30196-d123-Reviews-X.html`).
- Every new TS file starts with the 4-line header (filename — purpose / Inputs / Outputs / Used by). zod at API
  boundaries; external calls through `lib/services/*` with `retry` + `getLogger`.
- Code must keep working before migration 063 is applied (follow the existing "column/constraint missing → warn and
  save without it" pattern only where a write would otherwise fail; a batch with a new scraper value simply can't be
  created until 063 runs — the API returns the DB error).
- Copy rules for the email template: plain text, no "free", no "guarantee", one soft question, ends with the
  "Just reply 'no'" opt-out line, signs with the mailbox `from_name`.

## Review Focus

1. A robot returns an error row (`{type:"error", error:"…"}`) or a shape without `name` → the batch fails with that
   message in words, never a silent "0 leads, success". (Task 3 test.)
2. TripAdvisor batch city typed as "Austin, TX" → the robot gets "Austin" (the test run showed "Austin, TX" mis-resolves). (Task 3 test.)
3. Rows with `rating: null` or 0 reviews → dropped, not saved as leads. (Task 3 test.)
4. Rating exactly on the boundary (3.5 with max 3.5) → kept. (Task 3 test.)
5. The same profile twice in one run, or already a lead from an earlier batch → one lead; the earlier lead's rating and
   review count refreshed, stage untouched. (Task 5 test.)

---

### Task 1: Workflow doc, migration 063, types and batch settings

**Files:**
- Create: `workflows/run_review_site_batch.md` (operator SOP: what the sources find, fields, cost per 1,000, offer,
  AI calls blocked, Yelp deferred and why)
- Create: `db/migrations/063_review_sites.sql`; Modify: `db/schema.sql` (same constraint lines)
- Modify: `web/lib/batch-settings.ts`, `web/lib/services/types.ts`, `web/lib/pricing.ts` (`Scraper` union),
  `web/app/api/batches/route.ts` (zod enum), `web/components/NewBatchModal.tsx` (`Scraper` union only)
- Test: `web/lib/batch-settings.test.ts` (create or extend)

**Interfaces:**
- Produces: scraper values `"trustpilot" | "tripadvisor"`; `NormalizedLead.signal.type` gains `"review_site"`;
  `BatchSettingsSchema` gains `min_rating: number (1–5, default 1)`, `max_rating: number (1–5, default 3.5)`,
  `min_reviews: number int (0–100000, default 5)` with a refine `max_rating >= min_rating`.

Migration 063 (copy 057's drop-by-definition pattern): batches scraper check adds `trustpilot`,`tripadvisor`; leads
`signal_type` adds `review_site`; `primary_offer`/`secondary_offer` add `reputation_mgmt`; **`call_segment` check
re-added with `('no_website','old_website','has_website','liquidation','exhibitor','reputation')`** (exhibitor was
missing since 057).

- [ ] **Step 1: Write the failing tests**
```ts
it("review-site settings default and bound", () => {
  expect(BatchSettingsSchema.parse({})).toMatchObject({ min_rating: 1, max_rating: 3.5, min_reviews: 5 });
  expect(() => BatchSettingsSchema.parse({ min_rating: 4, max_rating: 3 })).toThrow();
  expect(() => BatchSettingsSchema.parse({ max_rating: 6 })).toThrow();
});
```
- [ ] **Step 2: Run** `npx vitest run lib/batch-settings.test.ts` → FAIL.
- [ ] **Step 3: Implement** the schema fields, the unions, the zod enum, the migration + schema.sql, the workflow doc.
- [ ] **Step 4: Run** the test → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat(db): review-site sources schema (migration 063)`

### Task 2: Generic Apify actor runner

**Files:** Create `web/lib/services/apify-run.ts`, Test `web/lib/services/apify-run.test.ts`

**Interfaces:**
- Produces: `runActor<T>(opts: { actor: string; input: Record<string, unknown>; maxChargeUsd: number; shouldStop?: () => boolean; pollMs?: number; fetchImpl?: typeof fetch }): Promise<{ items: T[]; status: string; usageUsd: number | null }>`
  — POST `/acts/{actor}/runs?token=…&maxTotalChargeUsd=…`, poll `/actor-runs/{id}` until a terminal status
  (SUCCEEDED/FAILED/ABORTED/TIMED-OUT), abort (`/actor-runs/{id}/abort`) when `shouldStop()` is true, then GET
  `/datasets/{defaultDatasetId}/items?clean=true`. Throws `ApifyRunError(message)` on a start error (include Apify's
  `error.message`) or FAILED/TIMED-OUT with no items. Uses `env.APIFY_TOKEN`, `retry` on start/poll only.

- [ ] **Step 1: Failing tests** (mock `fetchImpl`): returns items + `usageUsd` from `usageTotalUsd` on SUCCEEDED;
  throws `ApifyRunError` containing "Cannot parse input" when start returns 400 with that message; calls abort and
  returns the partial items when `shouldStop` turns true.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(pipeline): generic apify actor runner`

### Task 3: Trustpilot and TripAdvisor providers

**Files:**
- Create: `web/lib/review-sites.ts` (pure, shared), `web/lib/services/trustpilot.ts`, `web/lib/services/tripadvisor.ts`
- Create fixtures: `web/lib/services/__fixtures__/trustpilot-sample.json`, `tripadvisor-sample.json` (copy the 19 Nov
  test-run outputs from the scratchpad files `fx_trustpilot.json` / `fx_tripadvisor.json`, plus one error row
  `{"type":"error","error":"Yelp blocked…"}` appended to a copy for the error test)
- Test: `web/lib/review-sites.test.ts`, `web/lib/services/trustpilot.test.ts`, `web/lib/services/tripadvisor.test.ts`

**Interfaces:**
- Consumes: `runActor` (Task 2), `BatchSettings` fields (Task 1).
- Produces (`lib/review-sites.ts`): `type ReviewPlatform = "trustpilot" | "tripadvisor"`;
  `reviewPlaceId(platform, profileUrl): string`; `inRatingRange(rating: number | null, reviews: number | null, s: {min_rating; max_rating; min_reviews}): boolean`;
  `cityForTripAdvisor(city: string): string` (text before the first comma, trimmed); `robotAsk(limit: number): number` (= `min(limit*3, 300)`);
  `PLATFORM_LABEL: Record<ReviewPlatform, string>` ("Trustpilot", "TripAdvisor").
- Produces (providers): `searchTrustpilot(opts: { category: string; country: string; city?: string | null; settings; limit; maxChargeUsd; shouldStop? }): Promise<{ leads: NormalizedLead[]; usageUsd: number | null; found: number }>`
  and `searchTripAdvisor(opts: { city: string; category: "restaurants" | "hotels" | "attractions"; settings; limit; maxChargeUsd; shouldStop? })` (same return);
  pure `mapTrustpilotItem(item): NormalizedLead | null` / `mapTripAdvisorItem(item): NormalizedLead | null`.
  Each lead: `signal = { type: "review_site", date: null, source_url: profileUrl, meta: { platform, rating, review_count, profile_url, categories } }`,
  `rating`, `review_count`, `website` + `has_website`, `email`, `phone`, `address`, `country_code`, `place_id = reviewPlaceId(...)`.
- Trustpilot input: `{ categories:[category], countries:[country.toUpperCase()], location: city || undefined, minTrustScore: min_rating, maxTrustScore: max_rating, minReviews: min_reviews, maxResults: robotAsk(limit), onlyWithContact: true, recentReviews: 0 }`.
- TripAdvisor input: `{ locations:[cityForTripAdvisor(city)], categories:[category], maxPlacesPerCategory: robotAsk(limit), includeDetails: true }`.
- Both providers: drop error rows; if *every* row is an error/unmappable, throw `Error` with the robot's own error text;
  filter `inRatingRange`; slice to `limit`.

- [ ] **Step 1: Failing tests:**
```ts
expect(reviewPlaceId("trustpilot", "https://www.trustpilot.com/review/jdbyrider.com")).toBe("trustpilot:/review/jdbyrider.com");
expect(cityForTripAdvisor("Austin, TX")).toBe("Austin");
expect(inRatingRange(3.5, 10, { min_rating: 1, max_rating: 3.5, min_reviews: 5 })).toBe(true);
expect(inRatingRange(null, 10, defaults)).toBe(false);
expect(inRatingRange(2, 0, defaults)).toBe(false);
// fixture: trustpilot maps 5 leads, J.D. Byrider → email customerservice@jdbyrider.com, rating 2.4, review_count 3485, signal.type "review_site"
// fixture: tripadvisor drops "All About Wine" (rating null) and keeps "P. Terry's" (3, but 1 review → dropped with min_reviews 5)
// all-error dataset → searchTripAdvisor rejects with /blocked/
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(pipeline): trustpilot and tripadvisor providers`

### Task 4: Routing, qualification, calls blocked, Send email template and sender

**Files:**
- Modify: `web/lib/segment.ts`, `web/lib/offers.ts`, `web/lib/filters.ts` (`qualifies`), `web/lib/leads/contact-readiness.ts`
  (`callBlock` + `ContactFields.signal_type?`), callers of `callBlock` that build `ContactFields` (pass `signal_type`),
  `web/lib/email/service-templates.ts`, `web/lib/email/compose-context.ts`, `web/components/outreach/SimpleEmailModal.tsx`
- Audit: every `signal_type` truthiness check in `web/lib` + `web/app` (grep `signal_type`) — a `review_site` lead must
  not be treated as liquidation anywhere.
- Test: extend `segment`, `offers`, `filters`, `contact-readiness`, `service-templates` tests; create `web/lib/email/optirate-sender.test.ts`

**Interfaces:**
- Produces: segment `"reputation"` in `CALL_SEGMENTS`; offer `"reputation_mgmt"` in `OFFERS` (label "Reputation
  management"); `deriveSegment({signal_type:"review_site"}) === "reputation"`; `routeOffer` → `{primary_offer:"reputation_mgmt", secondary_offer:null}`;
  `ServiceKey` `"reputation_mgmt"` (label "Reputation management (low review rating)"), `defaultService("reputation") === "reputation_mgmt"`;
  `TemplateLead` gains `platform?: string | null; rating?: number | null; reviewCount?: number | null`;
  `ComposeContext` gains `platform`, `rating`, `reviewCount` (from `signal_meta`) and `preferredSender: string | null`;
  new pure `pickOptiRateSender(boxes: { email: string; sentToday: number; cap: number }[]): string | null` in
  `web/lib/email/optirate-sender.ts` — among addresses whose domain contains `optirate`, the one with the largest
  `cap - sentToday`; tie → alphabetical first (ethan@ before lily@); none → null.
- `qualifies` with `signal_type === "review_site"`: passes when any of phone / website / email present, else
  `{passes:false, reason:"no_contact"}` (add `email`/`website` to the input it receives).
- `callBlock`: `signal_type === "review_site"` → "AI calls don't pitch reputation management yet. Email this lead instead."

Template copy (`serviceEmail("reputation_mgmt", l)`): subject `` `${biz}'s ${platform} rating` ``; body opens with the
platform observation — Trustpilot: "most buyers check a company's TrustScore before they trust it"; TripAdvisor:
"travellers sort by rating before they book, so a low score quietly sends them to the place next door" — mentions
`${rating}★` and `${reviewCount} reviews` when known, offers to show how they'd lift it in a short call, signs with
OptiRate. Two follow-ups in the same style.

- [ ] **Step 1: Failing tests** (routing, qualify no_contact, callBlock text, `defaultService("reputation")`,
  `isSignalLead({signal_type:"review_site", …})` is true in `sequence-scheduler` (so the screenshot sequence refuses it),
  template subject `"Acme's TripAdvisor rating"` and body contains "2.4★" and "38 reviews" and not "free",
  `pickOptiRateSender([{email:"grace@rp.rateupdigital.com",sentToday:0,cap:50},{email:"lily@rp.optiratesolutions.net",sentToday:3,cap:16},{email:"ethan@rp.optiratessolutions.com",sentToday:1,cap:16}]) === "ethan@rp.optiratessolutions.com"`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (modal: when `preferredSender` is set, it is the initial `from`).
- [ ] **Step 4: Run** all tests → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(pipeline): reputation segment, offer, template and optirate sender`

### Task 5: Stage 1 wiring, re-found profiles, cost notice

**Files:** Modify `web/lib/pipeline/stage-1-scrape.ts`; Create `web/lib/pipeline/refound.ts` (pure); Test `web/lib/pipeline/refound.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `splitRefound(rows: Record<string, unknown>[], existing: Map<string, string>): { insert: Record<string, unknown>[]; refresh: { id: string; patch: { rating: unknown; review_count: unknown; signal_meta: unknown } }[] }`
  — `existing` maps `place_id → lead id` of leads in *other* batches.

Stage 1 changes: dispatch `trustpilot` (country = `batch.city` 2-letter or `region`, category = `batch.niche`) and
`tripadvisor` (city = `batch.city`, category = `batch.niche`); both in `isSignalSource`; `dedupeByPlace` applied to
them; `maxChargeUsd` from Global Constraints; before `persistRows`, look up existing `place_id`s for these sources
(`.in("place_id", ids).neq("batch_id", batch.id)`), refresh those leads, insert the rest; append a batch notice
"`${PLATFORM_LABEL}` robot: N found, M kept, cost $X" through the same `mergeNotices` path as `saveAiNotices`.
`enrichOne`: `review_site` behaves like `exhibitor` for contacts (own-site crawl when a website is known, AI contact
finder eligible) and skips audit/build enrichment.

- [ ] **Step 1: Failing tests** for `splitRefound`: a row whose place_id is in `existing` goes to `refresh` with only
  rating/review_count/signal_meta; others to `insert`; empty map → all insert.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** both the pure function and the stage-1 wiring.
- [ ] **Step 4: Run** all tests → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(pipeline): run trustpilot and tripadvisor batches in stage 1`

### Task 6: Cost estimate, New batch form, lead page line, docs

**Files:** Modify `web/lib/pricing.ts` (+ test), `web/lib/config.ts`, `.env.example`, `web/components/NewBatchModal.tsx`,
the lead page header (where exhibitor leads show their event — grep `eventName`/`signal_meta` in `web/app/(dashboard)/leads/[id]`),
`CLAUDE.md`, `web/lib/assistant/knowledge.ts`, `docs/status/2026-W47.md`.

**Interfaces:**
- Env: `APIFY_TRUSTPILOT_USD_PER_LEAD` (default 0.00018), `APIFY_TRIPADVISOR_USD_PER_PLACE` (default 0.00199),
  `APIFY_TRIPADVISOR_RUN_USD` (default 0.005).
- `estimate("trustpilot"|"tripadvisor", limit)`: robot line for `robotAsk(limit)` rows + the AI contact-finder line
  (same as exhibitors); not buildable.
- New batch form: Source "Review sites" (hint "Low-rated businesses · Trustpilot or TripAdvisor · reputation offer");
  then site choice; Trustpilot: country + category (text, with a few suggestions such as `car_dealer`,
  `furniture_store`, `restaurant`) + optional city; TripAdvisor: city + type (restaurants / hotels / attractions);
  both: rating range and minimum reviews (sends `settings`). No "Any" niche.
- Lead page: "Found on TripAdvisor · 2.4★ · 38 reviews · View profile" for `signal_type === "review_site"`.

- [ ] **Step 1: Failing test** `estimate("trustpilot", 100)` has a line with qty 300 and unit 0.00018, `buildable` lines absent.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** all of the above.
- [ ] **Step 4: Verify:** all tests pass, typecheck clean, `npx eslint` on touched files clean, `npm run build` succeeds.
- [ ] **Step 5: Commit** `feat(web): review-site sources in the new batch form`

### Task 7: Live check (operator-approved, a few cents)

- [ ] Operator applies migration 063 in Supabase and redeploys Cloud Run (`bash scripts/deploy-cloud-run-job.sh`).
- [ ] Create one Trustpilot batch (limit 5) and one TripAdvisor batch (limit 5) from the live site; confirm leads show
  "Found on …", segment Reputation, Send email defaults to the reputation template and Ethan/Lily, Call with AI refuses,
  and the batch notice shows the robot cost. Run the same Trustpilot batch again → no new leads, ratings refreshed.
