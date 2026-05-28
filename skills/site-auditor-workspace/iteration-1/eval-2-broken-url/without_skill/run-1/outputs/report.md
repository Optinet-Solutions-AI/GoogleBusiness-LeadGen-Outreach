# Site Audit — https://example.com

**Date:** 2026-05-28
**URL submitted:** `https://example.com`
**HTTP status:** 200 OK
**Server:** Cloudflare
**Payload size:** 528 bytes

## TL;DR — Headline Finding

**This URL is not a real business website.** `example.com` is the reserved placeholder domain operated by IANA (RFC 2606 / RFC 6761) and exists explicitly "for use in documentation examples without needing permission." It returns a single static informational page with no business content whatsoever.

Treat this audit result as a **probable upstream data error**:

- A lead row in the pipeline appears to have `has_website = true` (or a stored `website` field) pointing at `example.com`.
- This usually means the Google Maps / Places listing had a placeholder, a parsing fallback wrote `example.com` into the `leads.website` column, or a test fixture leaked into production.
- **Action:** before sending any outreach for this lead, fix the source data. Flag the lead and either re-scrape the listing or null out the website so the qualifier treats it as `has_website = false`.

If the goal really is to audit the IANA example page on its own terms, the anti-patterns below apply — but every one of them is by design for a placeholder, not a fault to fix.

## Anti-Patterns Detected

1. **No business identity** — no brand name, no logo, no favicon, no colors, no imagery.
2. **No contact information** — no phone, email, address, hours, service area, contact form.
3. **No call-to-action** — only link goes off-site to `iana.org`.
4. **No services / no value proposition** — only ~17 words of body copy.
5. **No social proof** — no reviews, testimonials, ratings, badges.
6. **No navigation / single-page only**.
7. **No SEO foundations** — generic title, no meta description, no OG tags, no JSON-LD.
8. **No analytics or tracking**.
9. **No security / trust signals beyond HTTPS**.
10. **Accessibility gaps** — no semantic landmarks.
11. **Performance is "good" only because it's empty** — Lighthouse would score ~100 with nothing to load.
12. **Mobile / responsive** — viewport meta present, layout works.
13. **No outreach hook for our pipeline** — nothing to extract for stages 2-5.

## Pipeline Implications

| Stage | Behavior on this URL | Recommended handling |
|-------|---------------------|----------------------|
| Stage 1 — scrape | Likely wrote `website = "example.com"` from a malformed Places result | Add a denylist for placeholder TLDs |
| Stage 2 — enrich | Color extractor returns neutral grey from `#eee`; email lookup fails | Add a `flag_placeholder_website` column |
| Stage 3 — generate | Would proceed normally | Make sure demo URL doesn't use `example.com` as slug seed |
| Stage 4 — deploy | Unaffected | — |
| Stage 5 — outreach | Email referencing "your current site" would embarrass us | Skip that line when placeholder flag is set |

## Recommended Fix-Forward

1. **Add a placeholder-domain detector** in `web/lib/filters.ts`. Hosts to treat as "no real website":
   - `example.com`, `example.org`, `example.net`
   - `*.example`, `*.test`, `*.invalid`, `*.localhost`
   - bare IPs, `localhost`, `127.0.0.1`
   - Facebook / Instagram / LinkedIn URLs (those are profiles, not websites)
2. **Backfill existing leads**: flip `has_website` to `false` for placeholder matches.
3. **Dashboard badge**: show a "placeholder URL" pill so operator decides per-lead.
4. **Don't re-run paid scrapes** — fix is purely a downstream filter.

## Verdict

- As a "site to audit for anti-patterns": it has essentially **all** of them, but that's the wrong question — it's a placeholder.
- As a **pipeline signal**: this URL appearing in lead data is a bug in upstream scraping or a stale test fixture. Fix the filter, flag the lead, do not send outreach against it.
