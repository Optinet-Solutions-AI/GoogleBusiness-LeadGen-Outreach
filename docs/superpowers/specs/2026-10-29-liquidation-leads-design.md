# Liquidation Leads — Design (slice 1: WARN closures)

**Date:** 2026-10-29 · **Status:** draft, written as the controller's calls (operator skipped the brainstorm questions) · **Client:** Meny (buys remaining inventory from US businesses)

## Intent

Meny wants US companies that need to get rid of inventory — closing or bankrupt businesses, overstocked businesses, outlets/clearance sellers, expiring or dead stock — with contact details, so he can approach them about buying what's left. Today's app only finds Google-Maps businesses by niche + city. This adds a second *kind* of lead source — **closure signals** — into the same batch → leads → outreach pipeline, so Meny runs it from the dashboard like any batch.

**Slice 1 (this design):** the free **WARN Feed** (APVentureEngine/warn-act-notices; CC BY 4.0, credit "WARN Feed"): every state's WARN Act closure/layoff notices, normalized to 11 fields, JSON/CSV, no key, daily refresh. Covers Meny's target 1 ("bankrupt or closing businesses") for closures announced 60+ days ahead — exactly when inventory is still on hand.

**Later slices (not here):** bankruptcy filings (SEC EDGAR 8-K Item 1.03 — its search API blocks non-browser clients from our network; PACER is paid), liquidation marketplaces (B-Stock, HiBid, AuctionZip, Liquidation.com, Direct Liquidation, Via Trading, 888 Lots, GovDeals, BidSpotter — HTML scraping and/or buyer accounts; terms to be checked per site), a daily standing WARN sync, Hunter company→domain search. Meny's target 3 (outlet/clearance businesses) already works today via a Google-Maps batch with niches like `liquidation store` / `outlet store` / `closeout`.

## Goals

1. From the New Batch modal, pick **WARN closures** as the source, a US state (or all states), the signal (closures only / closures + layoffs), a look-back window and a minimum headcount; see "$0.00" as the cost; run it; leads land at `scraped` with the closure signal visible in the leads table.
2. Each lead carries: company (trade name preferred), city/state, notice type, notice date, **effective date**, employees affected, the WARN Feed source link, and a stable dedupe id.
3. Enrichment finds a website (and from it an email/phone) for as many as possible, without paid calls by default.
4. Outreach: a **buy-inventory** plain-text cold email (single send, verification-gated like all sends) and the existing AI-call campaign. The website-demo machinery (Build, screenshot sequence) is hidden for these leads.
5. Idempotent re-runs (same notice never duplicated in a batch); attribution shown ("Source: WARN Feed, CC BY 4.0").

## Non-goals / anti-goals

- No marketplace scraping, no PACER/EDGAR, no overstock inference in this slice.
- Never pitch a website to these leads; never enroll them in the screenshot sequence.
- No paid API call without the usual confirmation (the WARN feed is free; Hunter/CSE stay opt-in).
- Don't break Google-Maps batches: every existing rule applies unchanged to `apify` / `google_places` / `outscraper`.

## How it plugs in (decided)

### Batch
- `batches.scraper` gains the value **`warn`** (migration 049 extends `batches_scraper_check`; same pattern as 023).
- `niche` (NOT NULL) carries the signal choice: `closures` or `closures_layoffs`. `city` carries the state: a 2-letter code or `US` (all states). `limit` ≤ 500. New optional batch settings in a `settings jsonb` column (migration 049): `{ window_days: 90, min_employees: 10 }`.
- Pricing: `estimate('warn', n)` → $0 (`WARN_MAX_PER_QUERY = 500`); the modal shows "Free — WARN Feed (CC BY 4.0)".
- UI: `NewBatchModal` gets a fourth `ScraperButton` "WARN closures"; when selected, the city field becomes a state select (50 states + "All US"), the niche field becomes the signal toggle, and window/min-employees inputs appear. `ScraperBadge` / `BatchesTable` learn the new value.

### Service `lib/services/warn-feed.ts`
- One state → `GET https://approjects-warn-act-notices.static.hf.space/data/by-state/<st>.csv` (follow redirects). All states → stream `/data/warn_notices.ndjson` (≈19 MB) and keep rows inside the window. ETag cached per URL in memory for the run.
- Filter: `notice_date` (or `effective_date`) within `window_days`; `employees_affected ≥ min_employees` (empty counts as 0 → kept only when `min_employees = 0`); `closures` = `notice_type` matches `/clos|shut|cease|permanent/i`, else layoff.
- Returns `NormalizedLead[]` (`lib/services/types.ts`): `business_name = company_dba || company_canonical || company`; `address = "<location>, <state>"`; `category = notice_type`; `phone/rating/review_count/website/email = null`; `has_website = false`; `website_kind = "none"`; `business_status = "OPERATIONAL"` (they are still trading until the effective date — never `CLOSED_PERMANENTLY`, which the filter rejects); `place_id = "warn:<id>"` (synthetic, for the `unique(place_id, batch_id)` upsert); `photos/reviews = []`; `raw = notice`; plus the signal fields below. Retries via `lib/retry.ts`; every fetch logged.

### Leads (migration 049, additive)
- `signal_type text` check in (`closure`, `layoff`, `bankruptcy`, `listing`) — null for Google leads.
- `signal_date date` (the effective date), `signal_source_url text` (the feed's per-state page), `signal_meta jsonb` (`{ warn_id, state, location, notice_type, notice_date, employees_affected, company_raw, company_canonical }`).
- Stage 1 writes them from the normalized lead; `db/schema.sql` mirrored.

### Qualification (`lib/filters.ts`)
- `qualifies(lead, { source })`: for `signal_type` leads skip the rating / review / phone / closed-permanently gates; reject only `stale_signal` (effective date more than 30 days in the past) and `below_min_employees`. Labels added to `REJECTION_REASON_LABEL`. Google leads: unchanged (tests prove it).

### Segment & offer
- `CALL_SEGMENTS += "liquidation"`, `OFFERS += "buy_inventory"` (label "Buy remaining inventory"); `offersForSegment("liquidation") = ["buy_inventory"]`; `routeOffer` returns the liquidation pair when `signal_type` is set; DB checks on `call_segment` / `primary_offer` / `secondary_offer` extended in 049. `offer_locked` semantics unchanged.

### Enrichment (`stage-2-enrich.ts`)
- No `place_id` → photos skipped (already guarded). Website discovery for signal leads: Google CSE (`GOOGLE_CSE_API_KEY` / `_CSE_ID`, already optional) query `"<company>" <state> official site`, first non-aggregator result → `website_url` + `classifyWebsite`; if CSE is not configured, fall back to the existing `findSocialUrl` (FB/IG). Then the existing free homepage/contact crawl for email; extend that crawl to also pull the first US phone number it sees (regex) when the lead has none. No logo/brand-color/audit steps for signal leads (nothing to build).

### Outreach
- New email template `buy_inventory` for `stage-5-email.ts` (plain text, no image/link, ≤ 120 words: who we are, we buy remaining inventory from closing locations, one question, opt-out line). Sent through the same verification-gated, warmup-capped SMTP path. Reply/bounce/unsubscribe handling unchanged.
- Call campaigns: liquidation leads are eligible for the Voizo `call` channel as-is (the script lives in Voizo; the operator creates a campaign for them).
- Dashboard: for `signal_type` leads the lead row/detail shows "Closure · effective 2026-11-23 · 80 staff · WARN Feed ↗"; **Build**, **Enroll** and the demo-site panel are hidden; **Email (inventory offer)** and the call-campaign add remain. Leads table filter "Signal: closure / layoff".

### Runtime
- Stage 1 for `warn` runs wherever stage 1 runs today (Cloud Run `MODE=batch`, or the CLI). The feed fetch is well under a minute; the all-states NDJSON stream is the only large transfer and stays server-side.

## Constraints

- US only (the feed is US-only; GDPR flag irrelevant). Attribution "WARN Feed, CC BY 4.0" wherever the source is shown.
- No new env vars required. CSE and Hunter remain optional and off by default.
- Additive migration 049 only; `leads.stage` enum untouched; envelope unchanged; file headers, thin routes, server-only guard, typecheck/lint/test clean per CLAUDE.md.
- Costs: $0 for the scrape; enrichment uses only free calls unless CSE is configured (CSE free tier 100/day).

## Left to the builder

- Exact state select data (50 states + DC), the window/min-employees defaults placement in the modal, column widths in the leads table.
- The CSE query heuristics and the "aggregator" domain blocklist (linkedin, facebook, yelp, bbb, mapquest, zoominfo, dnb, glassdoor, indeed, crunchbase, wikipedia).
- Phone regex for the contact-page crawl (US formats), with a unit test.
- The email template's exact wording (keep it plain, honest, short; no claims about Meny beyond "we buy remaining inventory"; sender identity from the connected mailbox).

## Acceptance (operator-visible)

1. New batch → WARN closures → state `TX`, closures only, 90 days, ≥ 10 staff → cost $0 → run → leads at `scraped` with signal columns; re-running the batch adds zero duplicates.
2. One lead enriched: a website found (CSE configured) or a FB page (fallback); email or phone captured where the site has one.
3. Lead detail hides Build/Enroll; "Email (inventory offer)" sends the plain-text template through the normal gates (verified address, warmup cap).
4. A Google-Maps batch run after this change behaves exactly as before (existing tests green; one smoke batch on Apify is the operator's call — paid).
