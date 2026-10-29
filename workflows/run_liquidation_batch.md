# Run a liquidation batch (WARN closures)

**Who it's for:** finding US businesses that are closing or cutting a site, so an inventory buyer can offer to buy what's left.

## Two ways to find them
1. **WARN closures** (closing businesses) — New batch → **WARN closures** → state (or All US) → *Closures* or *Closures + layoffs* → look-back days (90) → minimum staff (10) → Run. Free.
2. **Google Maps** (outlets, closeouts, surplus, near-expiry) — New batch → niche from **Liquidation & Surplus** (liquidation store, closeout store, wholesale liquidator, salvage grocery store…) → city → Apify. Paid as usual.

## What a WARN lead holds
Company, city/state, notice type, **effective date**, staff affected, a link to the notice (WARN Feed, CC BY 4.0). Some states (TX, FL, NJ, OH, NY) don't publish a notice type — those show as "WARN notice (type not published)" and are included in *Closures* batches.

Rejected automatically: effective date more than 30 days ago (`stale_signal`), known staff below the minimum, the same company twice in one batch (`duplicate_company`).

## Enrichment (automatic, free)
Right after the scrape: the company's website is found by guessing its domain from the name and checking it loads and names the company; then the site's contact pages give an email and phone. Expect a modest hit rate; add a phone/email by hand on the lead page when you find one.

## Outreach
Lead page → **Email (inventory offer)**: short plain-text email offering to buy remaining stock, with a reply-"no" opt-out. Same verification + warm-up limits as every send. Or add the leads to an AI-call campaign. Build / screenshot sequence are not available for these leads.

## Where it runs
Prod batches run on the Cloud Run job (`MODE=batch`/`queue`) — redeploy it after code changes (`bash scripts/deploy-cloud-run-job.sh`). Locally: `npm run run:batch -- --niche=closures --city=TX --scraper=warn --limit=50` (from `web/`).

## Checklist
- [ ] Migration 049 applied · [ ] Cloud Run job redeployed · [ ] sender mailbox connected and warmed · [ ] review leads before emailing
