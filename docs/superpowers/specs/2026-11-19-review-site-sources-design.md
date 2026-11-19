# Review-site sources (Trustpilot, TripAdvisor, Yelp) — design

Date: 2026-11-19 · Part 1 of the merge of John's lead-gen tool ("the forums tool",
github.com/Optinet-Solutions-AI/Trustpilot-LeadGen-EmailOutreach) into this app.

## Why

Meny decided the two lead-gen tools become one. This app stays (it has far more: Google Maps, demo sites, AI
calls, AI Lookup, CRM stages, Brand Brain, Creative Studio); John's tool contributes what we lack. The biggest gap is
John's lead **sources**. This part brings in his three review sites. Later parts (separate designs): Facebook /
Instagram, forums (ForexPeaceArmy; code not pushed yet), four small extras (send calendar, counts by email-check
result, auto language, contacts from auto-replies), then moving John's data in.

John's tool sells **reputation management** under the **OptiRate** brand to businesses with a **low rating** on a
review site ("a low rating quietly sends customers to higher-rated competitors"). The operator confirmed we keep that
offer for these leads.

## Goals

- The New batch form offers three more sources: **Trustpilot**, **TripAdvisor**, **Yelp**.
- A batch finds businesses on that site by **country/city + category**, keeps only those in a **rating range**
  (default 1.0–3.5 stars, operator-adjustable) with at least N reviews (default 5), up to the batch limit.
- Each kept business becomes a normal lead (Leads list, lead page, CRM, Inbox, Send email, AI Lookup; AI calls are
  blocked for now, see answer 5) that
  shows where it came from: the site, its rating, review count and a link to its profile.
- These leads get the new offer **Reputation management**: the routing never pitches a website to them, and Send
  email's "What are you offering?" gets a **Reputation management** template that names the site, the rating and the
  review count.
- Contacts are filled the same way as exhibitor leads: email/phone from the robot when the site lists them, then the
  existing own-website contact scan and the OpenAI contact finder (same cap and cost estimate).
- The batch cost estimate covers the robot's price; nothing paid runs without the existing confirm step.

## Non-goals

- No Facebook/Instagram, forums or Booking.com here.
- No reading of individual reviews, no reply-to-review features, no screenshot of the review profile (John's tool had
  one; can come later).
- No new sending path, campaign builder or inbox changes.
- No moving of John's existing data (later part).
- No re-use of John's Python code, ScrapingBee, Yelp Fusion API or his EC2 workers.

## Anti-goals (would make this a failure even if it "works")

- Pitching a website build to a review-site lead in any automated email.
- Spending money on a run the operator didn't confirm, or a run whose cost isn't shown afterwards.
- Duplicating the same business when it's found again in a later batch.
- Getting our Apify account banned, or bypassing a site's bot checks ourselves (the robots are third-party Apify
  actors; we never add our own bypass).

## Constraints

- Same architecture as the other sources: stage 1 on the Cloud Run job, a provider file per site under
  `lib/services/`, results through the existing stage-1 save path, `{success,data|error}` APIs, required file headers,
  zod at boundaries, retry + logging on every external call.
- Schema change only by a new migration (063), and the code must keep working before it's applied (the app's
  existing "tolerate missing columns" pattern).
- `leads.stage` values unchanged.
- Apify robots are community actors: their input/output shapes can change. Each provider file maps the robot's output
  into one internal shape and fails with a clear operator-readable error on an unexpected shape.

## Decisions already made

- **Offer:** reputation management, OptiRate brand (operator, 19 Nov 2026).
- **How we scrape:** Apify robots called from our own TypeScript code (we already pay Apify for Google Maps). John's
  Python scrapers are reference only (filters, rating range, pitfalls).
- **Candidate robots** (to confirm with one small paid test run per site, operator-approved, before wiring):
  - Trustpilot: `scrapersdelight/trustpilot-business-leads-scraper` (~$0.18 / 1,000, only rows with a contact
    billed, category + country input, returns email/phone/website/TrustScore); fallback `deepmine/trustpilot-company-data`.
  - TripAdvisor: `clearpath/tripadvisor-scraper` (~$1–2 / 1,000 places, city input, phone/email/website/rating);
    fallback `epicscrapers/tripadvisor-scraper`.
  - Yelp: pick during the test among `foxlabs/yelp-business-scraper`, `rbbscrap/yelp-scraper`,
    `lmbtechnology/yelp-business-scraper` (must return phone + website; some charge extra for details).
- **Lead shape (my call):** follow the exhibitor pattern. New `batches.scraper` values `trustpilot`, `tripadvisor`,
  `yelp`; leads carry `signal_type = 'review_site'`, `signal_source_url` = the profile URL, `signal_meta` =
  `{platform, rating, review_count, profile_url, categories}`; `rating`/`review_count` columns filled too. New segment
  `reputation` and offer `reputation_mgmt` (check-constraint additions in migration 063), routed in `deriveSegment` /
  `routeOffer` like `exhibitor`.
- **Duplicates (my call):** `place_id` = `<platform>:<profile URL path>` so the existing per-batch uniqueness and
  cross-batch skip apply; a later batch that finds the same profile updates rating/review count instead of adding a lead.
- **Sender (my call):** Send email defaults reputation leads to an OptiRate mailbox (Ethan or Lily) since the pitch is
  OptiRate; the operator can still pick Grace.
- **Pitch wording:** reuse John's per-site observations (TripAdvisor: travellers sort by rating before booking; Yelp:
  locals check Yelp before choosing; Trustpilot: buyers check the TrustScore before trusting a company), plain text,
  no "free", one soft question, the "just reply 'no'" opt-out line.

## Answers to the builder check (19 Nov 2026; all marked "my call" are Claude's, operator may override)

1. **Which rows become leads (my call):** rows outside the rating range or under the minimum reviews are dropped
   before saving (they were never targets). Kept rows with no email, phone *and* no website are saved with
   `qualified=false`, reason "no contact" (same as other sources). `qualifies()` gets a `review_site` branch: needs at
   least one of email / phone / website; no Google-rating or phone rules.
2. **Re-found profile (my call):** a later batch that finds a profile already on a lead (any stage, any batch) only
   refreshes `rating`, `review_count` and `signal_meta` on that lead. It never changes stage, contacts or offer, and
   never adds a second lead. This is a new small branch next to the existing cross-batch skip.
3. **Batch settings (my call):** `batches.settings` = `{min_rating (1.0–5.0, default 1.0), max_rating (1.0–5.0,
   default 3.5, ≥ min), min_reviews (0–100000, default 5)}`, zod-validated. `limit` = kept leads wanted; the robot is
   asked for up to 3× the limit (capped at the source's safety cap, 300) because some rows fall outside the filter.
4. **Field mapping (my call):** Trustpilot: `city` = 2-letter country code (like exhibitors), `niche` = Trustpilot
   category. TripAdvisor / Yelp: `city` = "City, Country" (like Google Maps), `niche` = category (free text or the
   robot's list). The "Any" niche is not offered for these sources in this part.
5. **Routing audit (my call):** every place that treats "any `signal_type`" as liquidation must check
   `review_site` first (`deriveSegment` is one; the builder audits all `signal_type` uses). **AI calls are blocked for
   review-site leads in this part**: the standing Voizo campaigns' fixed scripts don't pitch reputation management.
   They come back once a Voizo campaign with a reputation script exists.
6. **Secondary offer:** none (null), like exhibitors.
7. **Sequences (my call):** reputation leads can't be enrolled in the screenshot sequence or a demo-site campaign
   (refused like liquidation leads). They're emailed through Send email (with its optional follow-ups) only.
8. **Default sender (my call):** the OptiRate mailbox (Ethan or Lily) with more of today's warm-up allowance left;
   ties go to Ethan. One-off Send email isn't held by the allowance, so there's no other fallback.
9. **Robot confirmation:** the plan's first task is one small, operator-approved test run per site (5–10 businesses
   each, a few cents in total). Each provider's output mapping is written against that real output, saved as a test
   fixture. No provider is wired before its run.
10. **Cost (my call):** per-robot price constants in env with defaults (pattern: `APIFY_ADS_USD_PER_AD`), used by
   `lib/pricing.ts` for the estimate. The actual cost is recorded the way Apify Google-Maps runs already record it
   (the builder confirms which field).

## Left to the builder

- Exact New batch form layout for the rating range / minimum reviews fields and which category lists to offer per site
  (each robot's own category list, or free text).
- The provider files' internal mapping and how a robot's country/city input is built from our batch fields.
- Cost-estimate numbers per robot after the test run.
- Lead page wording/placement of the "Found on Trustpilot · 2.1★ · 38 reviews · View profile" line.
- Tests: pure mapping + filtering + routing + template functions get unit tests; provider calls are mocked.
