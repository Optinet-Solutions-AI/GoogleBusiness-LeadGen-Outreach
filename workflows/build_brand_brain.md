# Workflow — Build a client's Brand Brain

**Objective:** turn a client's real sources (site, socials, Google Maps, what you learned on the call)
into one sourced, versioned business profile that later phases generate social content from.
Nothing in it is guessed: every fact cites where it came from, and the AI never overwrites an operator's edits.

**Owner code:**
- `web/lib/clients/`: `clients`, `sources`, `profile`, `products`, `assets`, `facts`, `build-brain`, `crawl/`, `extract/`.
- `web/lib/services/gemini-brand.ts`: the Gemini calls (facts, voice).
- `web/app/api/clients/…`: thin routes. Dashboard: `/clients`, `/clients/[id]`.

**Runs on:** Cloud Run `MODE=brand-brain CLIENT_ID=<id>` (triggered by the Build button).

**Schema:** migration `046_clients_brand_brain.sql`.

---

## What a client is

A business we work for or are piloting with. A lead is a prospect; a client owns the Brand Brain,
products and assets. Make one from a lead (**Make client** on the lead page, idempotent, keeps the
link) or from scratch (**New client** on `/clients`). Status: `pilot` / `active` / `paused` / `churned`.

## Sources (client page, Overview)

| Kind | Contributes | How |
|---|---|---|
| `website` | pages of text, logo, colours, images | crawl, up to `BRAND_BRAIN_MAX_PAGES` pages |
| `demo_site` | same, but facts are **AI-drafted**, so confirm them | crawl |
| `facebook` / `instagram` | profile picture, title, description, visible bio | shallow logged-out read; `partial` / `blocked` is normal, never an error. Posts are not read |
| `google_maps` | name, category, address, phone, rating, hours, reviews; the lead's brand colour, logo and photos | from the lead row (photos and a real `http(s)` logo are copied into assets; a monogram logo is not). Our scraper returns no reviews, so the first build fetches up to 10 Google reviews once (Apify reviews actor, ~$0.01, capped at $0.02) and caches them on the lead; up to 8 with a reviewer become the profile's reviews (author shortened to "First L.") |
| `operator` | the intake form | highest authority: it wins over any page |

Add / re-crawl / remove sources on the Overview tab (source URLs must be `http(s)`).

**Cloudflare note:** a site behind Cloudflare Bot Fight Mode (including rateupdigital.com) returns 403 to the
crawler. The crawler can identify itself with a **secret** header `x-rateup-crawler: <token>`:

1. Generate a token: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`.
2. Put it in the repo-root `.env` (and the Cloud Run job's env) as `BRAND_BRAIN_CRAWLER_TOKEN=<token>`.
   Unset = the header is not sent.
3. Cloudflare, Security, WAF, custom rule `(http.request.headers["x-rateup-crawler"][0] eq "<token>")`,
   action **Skip** (incl. Bot Fight Mode). Or turn Bot Fight Mode off.

The token is sent only to the client's own site (page fetches, image/logo downloads, the headless fallback),
never to third-party image hosts. Rotate it by changing both the env var and the rule.

## Intake form (Intake tab)

Fill it from the sales call: what they sell, customers, tone + a sentence, always mention, never claim,
call to action (call / book / message / visit / website + number or link), anything else. Saved as the
`operator` source. A client with no website needs this: with no page text and no intake, the voice stays empty.

## Build

Overview, **Build Brand Brain** (refused with no sources; disabled while one is running, 409 if a second
is started). The job:

1. Crawls website / demo site / socials; reads Maps facts and the intake; copies the lead's Maps photos
   (up to 30, skipped once ~30 s has gone into copying images) and its logo.
2. Gemini call 1: facts + products + claims. Every fact must cite a source and a quote that really appears
   in it: a page, or the intake / Maps text exactly as the model saw it. A short value (40 characters or
   fewer) found verbatim in the cited text also counts. Facts that fail are **dropped**, with reasons logged
   (`unknown_page`, `source_absent`, `quote_not_found`, `missing_quote`, `unknown_path`). A product's price is
   kept only when it appears in the product's quote.
3. Gemini call 2: voice (skipped when there is no page text and no intake; the Brain tab then says
   "Fill in the Intake tab to set the voice"). Voice entries show as **AI summary**. At most 3 Gemini calls per build.
   Primary colour: the crawled site's colour, else the lead's brand colour.
4. Writes a new version. **First build** becomes `current`. **Any later build** is written as a
   `pending_review` draft and never overwrites the current profile or its products.
5. Logs a `generation_jobs` row: tokens, cost (list-price estimate), duration, facts kept/dropped.

A typical build costs well under a cent to ~2 cents (plus ~$0.01 the first time reviews are fetched). Every build is a paid call: don't re-run to "try again" without a reason.

## Reviewing a draft (Brain tab)

A banner offers **Review draft**: current vs draft per field. **Take draft** per field (merge),
**Accept all**, or **Discard draft**. Accepting writes the draft as a **new** current version (note
"Accepted draft vN"), so an editor left open with older data gets a "newer version" error instead of
overwriting it; it upserts suggested products (matched by name) with their photos. Only the newest draft is
ever reviewable: a new build retires any older draft.

## Confirming facts

Each field shows a source chip (page link or quote) and a confirm tick; **Confirm all** per group.
Saving creates a new operator version. **Everything the AI wrote starts unconfirmed**, including facts it
took from your intake or from Maps; only your tick or edit confirms a fact.

## Products and assets

- **Products tab:** edit inline, reorder, add. At most **10 featured**.
- **Assets tab:** drag-drop upload straight to storage. Limits: images 15 MB (jpg/png/webp),
  video 100 MB (mp4/mov), documents 20 MB (pdf). **Set as logo** on any image. Deleting an asset is
  safe: references are ignored. Assets are not versioned.

## Versions (History tab)

Every save and build is a version. View any version; **Restore** copies it forward as a new version
(products are re-materialised from its snapshot).

## Config

| Variable | Purpose | Default |
|---|---|---|
| `BRAND_BRAIN_MAX_PAGES` | pages crawled per source | 25 |
| `BRAND_BRAIN_TEXT_BUDGET` | characters of page text sent to Gemini | 60000 |
| `BRAND_BRAIN_CRAWLER_TOKEN` | secret `x-rateup-crawler` header value for a Cloudflare skip rule | empty (no header) |

Uses the existing `GOOGLE_GENAI_API_KEY`, Supabase, proxy and Cloud Run settings.

## Run it locally (no Cloud Run, from `web/`)

```
MODE=brand-brain CLIENT_ID=<client id> npm run run:job
```
Look for `job.done` (version, state, facts_kept, facts_dropped, cost_usd). Locally the headless-browser
fallback and the social proxy are unavailable, so JS-only sites and socials may come back thin or `blocked`.

## Before a build (checklist)

- [ ] migration `046` applied; job image redeployed (`bash scripts/deploy-cloud-run-job.sh`) so the dashboard button works
- [ ] at least one source attached; the site isn't behind an unskipped Cloudflare bot rule (token rule above)
- [ ] no-website client: intake filled in
- [ ] you accept paying for ≤ 3 Gemini calls
- [ ] after: check name, contact, no invented prices/awards, then confirm facts and set the logo
