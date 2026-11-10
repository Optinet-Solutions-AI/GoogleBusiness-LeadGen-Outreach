# Run an exhibitor batch (companies with a booth at European conferences)

**Who it's for:** a booth-building company. The leads are companies that exhibited (had a stand) at a conference or
trade show in Europe in 2026 — past or upcoming. The organisers and other booth builders are *not* targets.

**Where:** New batch → Category **Conference exhibitors** → pick the conference category (iGaming, gaming, technology,
food & drink, fintech, marketing, health, any), the country (or all of Europe), the year, and optionally paste
conference links → Run.

## How the batch works (stage 1 on the Cloud Run job)

1. **Find conferences.** If you pasted links, those are used. Otherwise OpenAI web search finds up to 12
   conferences for the country + category + year, with their exhibitor-list and floor-plan pages (≈ 5–10¢).
2. **Read the exhibitors.** For each conference, in this order:
   - **ExpoFP floor plan** (`<event>.expofp.com`): the plan publishes its exhibitor list openly — name, website,
     description, socials, booth number. Best source; hundreds of exhibitors per show. Free.
   - **The exhibitors page** on the conference site: fetched and read by Gemini into company / booth / website. Free.
   - A site that blocks automated visitors (Cloudflare "Just a moment…") is skipped and the batch log says so. We don't
     go around bot checks. Paste the ExpoFP link (look for "Open interactive floor plan" on expofp.com) or copy the
     exhibitor list into a CSV import instead.
3. **Each exhibitor becomes a lead** (`signal_type = 'exhibitor'`): conference name, dates, city, booth, the website
   from the list (or found by name), then contact research: **AI first** (OpenAI web search: email, phone, contact
   page, owner / marketing contact, each backed by a public page; 1–3¢ a lead, capped per batch), then the free crawl
   of the company's own site fills gaps and its email wins over a directory's. If OpenAI is unavailable the crawl
   still runs and the batch page says results are crawl-only; with no pasted links, conference discovery fails with
   a message saying to paste the links.
4. One company exhibiting at several shows is one lead (first show kept; the rest are logged as duplicates).

## Outreach

- Offer `booth_build`: a short plain-text email — "saw you at <event>, we design and build custom stands across
  Europe, want a quote for your next show?" — from the lead page (Email), or an AI-call campaign.
- No website is ever built or pitched to these leads. The screenshot sequence is unavailable.
- GDPR: these are companies, contacted at their business addresses, about a service for their trade activity.

## Cost

Free sources + about 1–3¢ per lead for contact finding, plus 5–10¢ per batch for conference discovery when you
don't paste links. A 200-exhibitor show ≈ $3–6.

## Data and code

- Migration `057_exhibitors.sql`: scraper `exhibitors`, signal type `exhibitor`, offer `booth_build`.
- `lib/services/expofp.ts` (floor-plan exhibitor list), `exhibitor-pages.ts` (page fetch + Gemini extraction),
  `openai-events.ts` (conference discovery), `exhibitors.ts` (the source: events → NormalizedLead[]).
- `batches.settings` = `{ event_urls: string[], year: 2026 }`; niche = category; city = country code or `EU`.
