# Run a review-site batch (Trustpilot / TripAdvisor)

**Owner code:** `web/lib/services/trustpilot.ts`, `web/lib/services/tripadvisor.ts` (Apify robots via
`web/lib/services/apify-run.ts`), shared rules `web/lib/review-sites.ts`, stage 1 `web/lib/pipeline/stage-1-scrape.ts`.
Design: `docs/superpowers/specs/2026-11-19-review-site-sources-design.md`. Part 1 of merging John's lead-gen tool.

## What it finds

Businesses with a **low rating** on a review site, to pitch **reputation management** under the **OptiRate** brand
("a low rating quietly sends customers to higher-rated competitors"). Never pitched a website.

| Source | Search by | Robot | Price |
|---|---|---|---|
| Trustpilot | country (+ optional city) + Trustpilot category (e.g. `car_dealer`) | `scrapersdelight~trustpilot-business-leads-scraper` (filters rating itself) | ~$0.18 / 1,000 businesses with a contact |
| TripAdvisor | city (name only — "Austin", not "Austin, TX") + restaurants / hotels / attractions | `clearpath~tripadvisor-scraper` (we filter rating) | ~$2 / 1,000 places + $0.005 per run |

Yelp is **not** offered: one robot was blocked by Yelp and `rbbscrap~yelp-scraper` returned **fabricated** businesses
(555 phone numbers) — never use it. Revisit with a robot proven on real data, or Yelp's official API.

## Steps

1. **New batch → Review sites →** pick the site, location and category.
2. Rating range (default 1.0–3.5 stars) and minimum reviews (default 5). The robot is asked for 3× the limit because
   some rows fall outside the range; the estimate shows that cost. Confirm the estimate.
3. Stage 1 (Cloud Run) runs the robot with a spending cap, keeps rows in range, fills contacts (robot email/phone, the
   business's own site, then the AI contact finder) and saves leads with segment **Reputation**.
4. A business already found in an earlier batch is **not** added again: its rating and review count are refreshed.
5. The batch shows a notice with the robot's real cost.

## Outreach rules

- **Send email** only (template "Reputation management"), default sender an OptiRate mailbox (Ethan or Lily).
- Not in the screenshot sequence or demo-site campaigns; **AI calls are blocked** (no Voizo reputation script yet).
- Leads with no email, phone or website are saved as not qualified ("no contact").

## When it fails

- "blocked" / robot error text in the batch error → the robot couldn't reach the site; try again later or fewer rows.
- 0 kept → the range or minimum reviews is too strict for that city/category.
- Database error on create → migration 063 isn't applied yet.
