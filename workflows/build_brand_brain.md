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
| `google_maps` | name, category, address, phone, rating, hours | from the lead row, no fetch |
| `operator` | the intake form | highest authority: it wins over any page |

Add / re-crawl / remove sources on the Overview tab. **Cloudflare note:** the crawler sends the
header `x-rateup-crawler: brand-brain`. A site behind Cloudflare Bot Fight Mode (including
rateupdigital.com) returns 403 until you add a WAF custom rule
`(http.request.headers["x-rateup-crawler"][0] eq "brand-brain")` with action **Skip** (incl. Bot Fight Mode),
or turn Bot Fight Mode off.

## Intake form (Intake tab)

Fill it from the sales call: what they sell, customers, tone + a sentence, always mention, never claim,
call to action (call / book / message / visit / website + number or link), anything else. Saved as the
`operator` source. A client with no website needs this: with no page text and no intake, the voice stays empty.

## Build

Overview, **Build Brand Brain** (refused with no sources; disabled while one is running, 409 if a second
is started). The job:

1. Crawls website / demo site / socials; reads Maps facts and the intake.
2. Gemini call 1: facts + products + claims. Every fact must cite a page and a quote that really appears
   there; facts that don't are **dropped**, with reasons logged.
3. Gemini call 2: voice (skipped when there is no page text and no intake). At most 3 Gemini calls per build.
4. Writes a new version. **First build** becomes `current`. **Any later build** is written as a
   `pending_review` draft and never overwrites the current profile or its products.
5. Logs a `generation_jobs` row: tokens, cost (list-price estimate), duration, facts kept/dropped.

A typical build costs well under a cent to ~2 cents. Every build is a paid call: don't re-run to "try again" without a reason.

## Reviewing a draft (Brain tab)

A banner offers **Review draft**: current vs draft per field. **Take draft** per field (merge),
**Accept all**, or **Discard draft**. Accepting upserts suggested products (matched by name) and adds the rest.

## Confirming facts

Each field shows a source chip (page link or quote) and a confirm tick; **Confirm all** per group.
Saving creates a new operator version. AI-written and demo-site facts stay unconfirmed until you tick them.

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

Uses the existing `GOOGLE_GENAI_API_KEY`, Supabase, proxy and Cloud Run settings.

## Run it locally (no Cloud Run, from `web/`)

```
MODE=brand-brain CLIENT_ID=<client id> npx tsx scripts/cloud-run-job.ts
```
Look for `job.done` (version, state, facts_kept, facts_dropped, cost_usd). Locally the headless-browser
fallback and the social proxy are unavailable, so JS-only sites and socials may come back thin or `blocked`.

## Before a build (checklist)

- [ ] migration `046` applied; job image redeployed (`bash scripts/deploy-cloud-run-job.sh`) so the dashboard button works
- [ ] at least one source attached; the site isn't behind an unskipped Cloudflare bot rule
- [ ] no-website client: intake filled in
- [ ] you accept paying for ≤ 3 Gemini calls
- [ ] after: check name, contact, no invented prices/awards, then confirm facts and set the logo
