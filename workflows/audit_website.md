# Workflow — Audit an existing website (improvement scoring)

> SOP for deciding whether a business's existing website is old/broken enough
> to pitch our **website-improvement** offer, vs healthy enough to drop.

## Objective

Given a lead that already has a real website (`has_website = true`,
`website_kind = 'real'`), measure its health and emit:

- `website_score` (0–100, higher = healthier)
- `website_issues` (array of issue codes)
- `needs_improvement` (boolean → drives the offer router)

No-website leads (`has_website = false`, including Facebook/Yelp/Linktree-only)
**skip the audit** — they always route to `build_website`.

## Required inputs

| Input | Source |
|-------|--------|
| `website_url` | `leads.website_url` (raw URL from the scraper) |
| `website_kind` | `leads.website_kind` (already classified in `filters.ts`) |
| `country_code` | `leads.country_code` / batch — picks the proxy egress country |

## Tool

`web/lib/services/website-auditor.ts` → `auditWebsite(url, { websiteKind, countryCode })`.
Reuses the shared headless Chromium singleton (`headless-browser.ts` →
`getBrowser` + `buildProxyOptions`) — same pattern as `playwright-logo.ts`.
One page load per audit. Never throws: on any failure returns an
`unreachable` verdict (treated as needs-improvement) so the pipeline never
crashes.

## Scoring criteria (each issue subtracts a penalty)

| Issue code | Detection | Penalty |
|---|---|---|
| `unreachable` | nav timeout (>8s) or final HTTP status 4xx/5xx | hard → `needs_improvement = true` regardless of score |
| `no_https` | final URL not `https://`, or TLS/cert error on the https attempt | 25 (also a hard auto-flag — see below) |
| `not_mobile` | no `<meta name="viewport">` (or fixed-width layout) | 25 |
| `slow` | DOMContentLoaded / load > 4000ms | 15 |
| `stale_content` | copyright year in footer > 2 years old, OR no `<meta name="description">` / thin `<body>` text (<400 chars) | 15 |
| `diy_builder` | `website_kind` is a free builder (wix_free/weebly/wordpress/etc.) — note: these usually fail `has_website` upstream, kept for completeness | 20 |

- `website_score = max(0, 100 − Σ penalties)`.
- `needs_improvement = website_score < 60 OR issues include 'unreachable' OR 'no_https'`.
  (A dead site, or a plain-`http://` site in 2026, is always worth the improve
  pitch — `no_https` alone lands at score 75, so it's promoted to an auto-flag.)

## Where it runs

Primary: **stage 1 enrichment** (`stage-1-scrape.ts` → `enrichOne`), so the
dashboard shows the offer + drops healthy sites at scrape time, before the
operator reviews. Stage 2 (`stage-2-enrich.ts`) re-runs the router from the
persisted audit but does **not** re-audit unless `website_score` is null
(keeps Build idempotent and cheap). An operator override (`offer_locked`)
freezes the routing.

## Edge cases / learnings

- Sites behind Cloudflare "checking your browser" interstitials may read as
  slow on first hit — the 8s timeout tolerates one challenge round-trip.
- A redirect from `http://` → `https://` counts as **HTTPS OK** (we read the
  final URL, not the typed one).
- Parked-domain pages (GoDaddy/Sedo placeholders) usually trip
  `stale_content` (thin body) + sometimes `unreachable`; that's the intent —
  a parked domain is a strong "build/improve" signal.
- Cost: ~free (compute only). No paid API. Safe to run on every lead.
