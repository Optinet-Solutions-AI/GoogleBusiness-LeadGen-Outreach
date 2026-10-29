# Design — Clients + Brand Brain (AI Social Autopilot, Phase 1)

**Date:** 2026-10-29 · **Status:** reviewed · awaiting operator approval · **Scope:** Phase 1 of the plan in
[`../plans/2026-10-28-ai-social-autopilot-plan.html`](../plans/2026-10-28-ai-social-autopilot-plan.html),
built from the brief in [`2026-10-28-ai-social-autopilot-prd.md`](2026-10-28-ai-social-autopilot-prd.md).

Written for a developer who knows this codebase (see `CLAUDE.md`) and will plan and build Phase 1
without further access to the operator.

---

## 1. Intent

RateUp sells websites to local businesses that have none. The next product is **AI social media
content** for those same businesses: the "AI services" offer for `has_website` leads that currently
has nothing behind it, and a monthly upsell for hosting clients.

Everything in that product (posts, images, captions, a calendar, auto-publishing) depends on the
system knowing the business well. Phase 1 builds that foundation: a **Client** record and its
**Brand Brain**, a structured, editable, versioned profile of the business where **every fact carries
its source**. Later phases generate content *from* the Brand Brain; nothing is generated from a
website summary or from the model's imagination.

### Operator decisions already made

| Decision | Choice |
|---|---|
| Who runs it | **Done-for-you.** The operator (Chris / the RateUp team) works from this dashboard on the client's behalf. Clients do not log in. |
| Client zero | **RateUp itself** (`rateupdigital.com`). The first profile is built and judged against it. |
| Starting point | **A client may have nothing**: no website, no Facebook, no Instagram. The profile must be buildable from the lead record plus what the operator knows. |
| Image generation (Phase 2) | OpenAI. Not used in Phase 1, but the data model must not assume Gemini-only. |
| Developer pack | Not available. The brief + plan are the only references. |
| Google Maps data | **Use it all.** Maps photos may be copied into our storage and reviews quoted as evidence for every client, whatever scraper found the lead. The operator accepts the Places-ToS exposure (CLAUDE.md flags it); no per-scraper exclusion is built. |

## 2. Goals, non-goals, anti-goals

**Goals (Phase 1 is done when all of these hold)**

1. The operator can create a client from an existing lead in one click, or from scratch with just a name.
2. A client can attach sources: website URL, Facebook page, Instagram page, the demo site we built, and an operator intake form. All optional.
3. "Build Brand Brain" runs on the Cloud Run job, reads every attached source, and produces a **draft profile**: business facts, voice, visuals (logo, colours, fonts), audiences, allowed claims, forbidden claims, CTAs, contact details, hours, and up to **10 suggested products/services** with photos.
4. Every fact, price and claim in the profile has a **source**: a crawled page URL with a quote, "Google Maps", "demo site", or "operator". Nothing is accepted into the current profile without one.
5. The operator can **edit any field**, confirm facts, add/remove/reorder products, upload photos and logos. Every save creates a new **version**; previous versions are viewable and restorable.
6. **RateUp's profile** (from rateupdigital.com) and **one no-website lead's profile** (Google Maps + intake form only) are both accepted by the operator after light edits.
7. Every Gemini call is logged as a **generation job** with model, tokens and estimated cost, so per-client cost is known from day one.

**Non-goals (later phases)**

- Making posts, captions, images or videos (Phase 2).
- Calendar, scheduling, publishing, social OAuth (Phase 3+).
- Customer logins, roles, tenant isolation, billing (Phase 6).
- Analytics on social performance (Phase 5).

**Anti-goals (a build that does these has failed even if it "works")**

- A profile field with no source, or an AI-invented price, discount, testimonial or claim.
- Treating demo-site copy (which was itself AI-drafted from Maps data) as verified fact.
- Changing `leads.stage` values or the lead pipeline's behaviour.
- Running crawls or Gemini calls that the operator did not trigger.
- Copying a competitor's content into a client's profile (reference-inspired work is Phase 5; nothing here stores third-party media).

## 3. Constraints

- All `CLAUDE.md` rules apply: file header docstrings, thin route handlers, `lib/` holds the logic, `import "@/lib/server-guard"` on anything touching secrets/DB, zod at every boundary, `tsc --noEmit` + lint + vitest clean before commit, Conventional Commits.
- Schema changes are **migrations** in `db/migrations/` (next number **046**) plus matching edits to `db/schema.sql`. Additive and idempotent, like 045.
- Long work (crawling, headless browser, Gemini) runs on the **Cloud Run job** via a new `MODE`, never in a Route Handler. Dispatch from a route uses `lib/services/cloud-run.ts` `triggerJob` with the Vercel OIDC token, like the Build button does.
- Gemini is on the free tier (≈1,500 req/day). One Brand Brain build should cost **≤ 3 Gemini calls** in the normal case.
- Headless Chromium exists only on Cloud Run (`lib/services/headless-browser.ts`); locally, browser-dependent steps degrade to plain `fetch`.
- Storage is **Supabase Storage**. Uploaded client media goes in a new bucket **`client-assets`** (public, unguessable paths), mirroring `lead-screenshots`.
- Dashboard pages follow the existing patterns: server components load via `safeDb`, client components are dumb, tables use `components/ui/DataTable`, actions call `/api/...` with `fetchJson` + toasts.
- Node 20+, Next.js 14 App Router, Tailwind. New dependencies must be justified in the commit message.
- GDPR: a client is a business that has engaged RateUp, so crawling its own properties is fine. Do not crawl anything that is not the client's own site/page.

## 4. The shape of the thing

### 4.1 Client

A **client** is a business RateUp works for (or is piloting with). It is distinct from a lead:
a lead is a prospect in the outreach pipeline; a client is a workspace that will own a Brand Brain,
assets, and (later) social connections and schedules.

- Created **from a lead** ("Make client" on the lead page; prefilled from the lead) or **from scratch** (name only).
- Keeps `lead_id` when it came from a lead so the lead's Maps data, photos, logo, colour, demo site and improve-flow uploads can be read without copying.
- Has a status: `pilot` · `active` · `paused` · `churned`. Default `pilot`.
- The dashboard gets a new nav group **"Clients"** with one item, **Clients** (`/clients`), listed between Pipeline and Outreach.

### 4.2 Sources

A client has zero or more **sources**. Each has a kind, an optional URL, a crawl status and its crawled pages:

| kind | What it is | How it's read |
|---|---|---|
| `website` | the client's real site | crawl (see §5.1) |
| `demo_site` | the demo/improved site we built (`leads.demo_url`) | crawl; facts are tagged **AI-drafted** and need confirmation |
| `facebook` / `instagram` | the client's own page | **shallow, logged-out read**: profile picture, page title and description (`og:` meta, as `playwright-logo.ts` already reads) plus any about/bio text visible without login. **Posts are not read in Phase 1.** Status `partial` when only meta came back; `blocked` when the page is a login wall or unreachable. Never an error |
| `google_maps` | the lead row | no fetch: name, category, address, phone, rating, hours, reviews, photos straight from `leads` |
| `operator` | the intake form (§4.4) | stored as text; **highest authority** |

Sources are attached by the operator on the client page and re-crawled on demand. The `google_maps`
source is added automatically when the client comes from a lead; `demo_site` is offered automatically
when the lead has a `demo_url`.

### 4.3 Brand Brain (the profile)

One JSON document per **version**. The current profile is the latest version. The shape:

```
business:   name · tagline · description · category · founded · languages ·
            contact { phone, email, address, website } · hours { mon..sun } · service_areas[]
voice:      tone[] (3–5 adjectives) · style_notes · do[] · dont[] · sample_lines[]
visuals:    logo_asset_id · colors { primary, accent, background, text } (hex) · fonts { heading, body }
audiences:  [{ name, description, pains[], wants[] }]
claims:     allowed[]   — things we may say (e.g. "family-run since 2004", "free quotes")
            forbidden[] — things we must never say (e.g. "cheapest in town")
ctas:       [{ text, kind: call | book | visit | message | website }]
social:     { facebook, instagram, tiktok, youtube, linkedin } (URLs, may be null)
```

**Every leaf value is a Fact:**

```
{ value, source: { kind, url?, page_id?, quote? }, confirmed: boolean }
```

`source.kind` is one of the source kinds above. `confirmed` is false for anything the AI wrote and
true once the operator confirms or edits it. A list field is a list of Facts. Fields the AI could not
find are `null`, never guessed.

**Products** are rows (`brand_products`) because later phases reference them from posts, **and**
every version's `data` JSON carries a `products[]` snapshot (full product objects, including asset
ids). The rows are the materialised *current* state; the snapshot is what versioning and restore
operate on. Fields: name, description, price (free text, may be null), category, images (asset ids),
featured (bool, max 10 featured), sort order, source + confirmed like a Fact.

- Operator save → write the rows, then snapshot them into the new version.
- AI build on a client that already has a profile → suggested products live **only inside the
  `pending_review` draft's JSON**; rows are untouched until the operator accepts/merges, at which
  point accepted products are upserted (matched by name, case-insensitive) and the rest added.
- Restore a version → rows are re-materialised from that version's snapshot (delete + insert, keeping
  ids where names match so asset links survive).
- **Assets are never versioned.** Deleting an asset nulls its references in rows and is tolerated
  (ignored) when a snapshot still mentions it.

**Assets** are rows: kind (`logo` · `photo` · `video` · `document`), storage path + public URL,
origin (`upload` · `website` · `facebook` · `instagram` · `google_maps` · `lead`), width/height,
tags, and which product (if any) they belong to. Crawled images are **copied into our bucket**, not
hot-linked, so profiles don't rot when a site changes.

### 4.4 Operator intake form

A short form on the client page, filled from the sales call. Free text throughout:

- What do you sell / do? (one paragraph)
- Who are your customers?
- How should you sound? (pick tones + a sentence)
- Things you always want mentioned
- Things you must never claim
- Preferred call to action (call / book / message / visit) and the number or link
- Anything else

Saved as an `operator` source. The build treats it as the highest authority: where it conflicts with
a crawled page, the form wins and the page's value is kept only as a note.

### 4.5 Versions

Every operator save and every AI build writes a **new version row** (`version` increments per client).
A version records who wrote it (`ai` or `operator`), an optional note, and the full profile JSON.
The client page shows a History tab listing versions; any version can be viewed and **restored**
(restore = copy it forward as a new version). The AI build never overwrites operator edits: it writes
its draft as a new version only when there is no profile yet; otherwise it writes a **draft** version
flagged `pending_review` that the operator merges field-by-field or accepts whole (see §6.3).

## 5. The build (Cloud Run `MODE=brand-brain CLIENT_ID=…`)

Triggered by the operator from the client page. Steps, each idempotent:

### 5.1 Crawl

For each `website` / `demo_site` source:
- Fetch the home page. Collect same-host links whose path or anchor text matches
  about · services · products · shop · menu · pricing · faq · contact · team · reviews · gallery.
- Fetch up to **25 pages** per source, **2 MB** each, 10 s timeout each, plain `fetch` first; if the
  home page is JS-rendered (near-empty text), fall back to the headless browser when available.
- Convert each page to clean text (strip nav/footer/script/style, keep headings, paragraphs, list
  items and prices). Store page rows: url, title, text, fetched_at. Replace the previous crawl of that
  source.
- Collect candidate images (reuse `extractWebsiteImages`), brand colour and logo (reuse
  `extractWebsiteBrand` / `resolveLogo`), and copy the best ≤ 30 images into `client-assets`.

For `facebook` / `instagram`: one page load each with the proxy; capture the profile picture (as an
asset), the `og:` title/description, and any about/bio text visible logged-out. No post reading. If
blocked, record `blocked` and move on. Locally (no proxy) a stub that records `blocked` is fine.

For `google_maps` and `operator`: no fetch; their data is read at extraction time.

### 5.2 Extract (Gemini)

One structured-output call (pattern: `generateSiteData` in `lib/services/gemini.ts`, with a
`responseSchema`), given:

- the operator intake text (if any), labelled as authoritative;
- the Google Maps facts (if any);
- the crawled page texts, each prefixed with a page id and URL, trimmed to a total budget of ≈ 60k
  characters (home + about + services/products + pricing + contact first; the rest in order);
- the list of asset ids with their alt text / page.

The prompt requires: for each fact, cite the page id (or `operator` / `google_maps`) and copy the
supporting quote; output `null` when nothing supports a field; list up to 10 products with the page
they came from; never invent a price, discount, award, testimonial or year. Output is validated with
zod; facts whose cited page id does not exist, or whose quote does not appear in that page's text,
are **dropped** (not kept unsourced). If the call fails validation, retry once with the validation
errors appended; on second failure the job records the error and writes nothing.

A second, cheaper call is allowed for **voice**: given 3–5 longest crawled passages + the intake
form, return tone adjectives, do/don't lists and sample lines. When there is **no crawled text and no
intake form**, skip the call and leave `voice` fields `null`; the Brain tab shows "Fill in the Intake
tab to set the voice" (there is no per-niche voice table in the codebase, and none is added).

### 5.3 Write

- Insert a `brand_profiles` version (`written_by = 'ai'`), products, and asset links.
- Insert a `generation_jobs` row: kind `brand_brain`, model, prompt/response token counts, estimated
  USD (Gemini Flash list price; constant in code), duration, status, error.
- Clear `clients.brain_started_at` in a `finally` (same in-progress-flag pattern as `rebuild_started_at`).

A build with **no sources at all** is refused at the route with a clear message.

## 6. Dashboard

### 6.1 `/clients`

DataTable (client mode): name, status, source badges (website / FB / IG / Maps / demo), profile
version, last built, cost to date, open. Toolbar: **New client** (name + optional website URL) and
search/filters. Empty state explains what a client is and points to "Make client" on a lead.

### 6.2 Lead page → **Make client**

Button on `/leads/[id]` (near Build/Enroll). Creates the client prefilled from the lead, attaches
`google_maps` (always) and `demo_site` (if `demo_url`) and `website` (if a real `website_url`) and
`facebook`/`instagram` (if `website_kind` is social), then redirects to the client page. Idempotent:
a lead maps to at most one client; the button becomes "Open client".

### 6.3 `/clients/[id]`

Tabs:

- **Overview**: status, sources (add / re-crawl / remove, with last crawl result), the **Build Brand
  Brain** button (disabled while `brain_started_at` is set, with the same polling spinner pattern the
  Build button uses), last job summary + cost.
- **Brain**: the profile editor. Grouped like §4.3. Each field shows its value, a source chip
  (click → opens the page URL / shows the quote), and a confirm tick. "Confirm all" per group.
  Save → new version. When a `pending_review` AI draft exists, a banner offers **Review draft**:
  side-by-side current vs draft per field, with per-field "take draft", and **Accept all** /
  **Discard draft**.
- **Products**: list with drag order, featured toggle (max 10), inline edit, image picker from assets,
  add product.
- **Assets**: grid of images/logos/videos with origin badges; upload (drag-drop); set as logo; delete.
  Uploads go **straight from the browser to Supabase Storage** using a signed upload URL the route
  hands out (Vercel caps Route Handler bodies at ~4.5 MB, so files never pass through our server):
  `POST /api/clients/:id/assets` returns `{ asset_id, signed_url, path }`, the browser PUTs the file,
  then `POST /api/clients/:id/assets/:aid/complete` records size/dimensions and makes it visible.
  Limits: images ≤ 15 MB (jpg/png/webp), video ≤ 100 MB (mp4/mov), documents ≤ 20 MB (pdf).
- **Intake**: the operator form (§4.4). Save stores/updates the `operator` source.
- **History**: versions with who/when/note; view; restore.

Client components stay dumb: all writes go through the routes below.

## 7. API (thin; validate → `lib/clients/*` → `{ success, data | error }`)

| Route | Method | Purpose |
|---|---|---|
| `/api/clients` | GET / POST | list · create (`{ name, website_url?, lead_id? }`) |
| `/api/clients/:id` | GET / PATCH / DELETE | detail · status/name/notes · delete (cascades) |
| `/api/clients/:id/sources` | POST / DELETE | attach `{ kind, url? }` · remove |
| `/api/clients/:id/intake` | PUT | save the intake form (upserts the `operator` source) |
| `/api/clients/:id/brain/build` | POST | sets `brain_started_at`, triggers Cloud Run `MODE=brand-brain` |
| `/api/clients/:id/brain` | GET / PUT | current profile (+ pending draft) · save as new version |
| `/api/clients/:id/brain/versions/:v/restore` | POST | copy version `v` forward |
| `/api/clients/:id/brain/draft` | POST | `{ action: accept \| discard \| merge, fields? }` |
| `/api/clients/:id/products` (+`/:pid`) | POST / PATCH / DELETE | product CRUD + reorder |
| `/api/clients/:id/assets` (+`/:aid`, `/:aid/complete`) | POST / POST / DELETE | issue signed upload · mark complete · delete |
| `/api/leads/:id/client` | POST | "Make client" (idempotent) |

## 8. Data model (migration `046_clients_brand_brain.sql`)

```
clients            id · lead_id (uuid null, unique, fk leads on delete set null) · name · status ·
                   website_url · country_code · timezone · notes · brain_started_at ·
                   current_version int · created_at · updated_at
client_sources     id · client_id (fk cascade) · kind · url · status (new|crawled|blocked|failed) ·
                   last_crawled_at · last_error · page_count · intake jsonb (operator kind only) ·
                   created_at · updated_at · unique (client_id, kind, url)
source_pages       id · source_id (fk cascade) · client_id · url · title · text · fetched_at
brand_profiles     id · client_id · version int · written_by (ai|operator) · state (current|superseded|
                   pending_review|discarded) · note · data jsonb · job_id · created_at ·
                   unique (client_id, version)
brand_products     id · client_id · name · description · price · category · featured bool · sort int ·
                   source jsonb · confirmed bool · created_at · updated_at
brand_assets       id · client_id · product_id (null) · kind · origin · storage_path · public_url ·
                   width · height · bytes · alt · tags text[] · source_url · created_at
generation_jobs    id · client_id · kind · provider · model · status · input jsonb · output jsonb ·
                   prompt_tokens · completion_tokens · cost_usd · error · started_at · finished_at
```

All tables: `disable row level security` like the rest of the schema; `updated_at` triggers where
listed; indexes on every `client_id`. `db/schema.sql` gets matching sections.

## 9. Config

| Variable | Purpose | Default |
|---|---|---|
| `BRAND_BRAIN_MAX_PAGES` | pages per crawled source | 25 |
| `BRAND_BRAIN_TEXT_BUDGET` | characters of page text sent to Gemini | 60000 |

Everything else (Gemini key/model, proxy, Cloud Run, Supabase) already exists. No OpenAI use in Phase 1.

## 10. Testing

- Unit (vitest, pure): page-link selection, HTML→text, fact validation (unsourced facts dropped,
  bad quotes dropped), draft merge logic, product featured cap, version numbering.
- A **fixture-based** extraction test: saved page texts for rateupdigital.com → the Gemini call is
  mocked with a recorded response → assert the validated profile shape and sources.
- Manual acceptance: build RateUp from its site; build a no-website lead from Maps + intake; both
  accepted after light edits; every claim/price has a working source; `generation_jobs` shows cost.

## 11. Rollout

1. Migration 046 + schema.sql. 2. `lib/clients/*` + crawler + extraction + Cloud Run mode. 3. Routes.
4. Dashboard pages. 5. "Make client" on the lead page. 6. Build RateUp (client zero), iterate on the
prompt until the operator accepts it. 7. Build one no-website lead. 8. Status doc entry.

## 12. Left to the builder

- Exact Gemini prompt wording and the `responseSchema`; the HTML→text approach (regex like the
  existing services, or a small parser dependency, justified in the commit).
- Page-selection heuristics beyond the keyword list; handling of pagination and non-English sites
  (the lead's `language_code` is available).
- Editor layout and interaction details; whether History shows a diff.
- How much of the FB/IG reader to attempt when the proxy is unavailable locally (a stub that records
  `blocked` is acceptable in dev).
- Cost constants and token accounting details.

## 13. Calls made in this document (flag if wrong)

- Demo sites are **crawled like any website** rather than reading the generator's JSON; their facts
  are tagged AI-drafted and unconfirmed.
- Facts carry source + confirmed **inline** in the profile JSON; products and assets are rows.
- AI builds **never overwrite** an existing profile; they land as a reviewable draft.
- The **intake form outranks crawled pages** on conflict.
- Crawled images are **copied** into our storage.
- A client has **one** profile lineage (no per-channel variants) in Phase 1.
- Products are rows **plus** a per-version snapshot; AI re-builds put suggested products only in the
  draft JSON; restore re-materialises rows from the snapshot; assets are never versioned.
- Facebook/Instagram reading is **shallow** (profile picture + `og:` meta + visible about text); no
  post scraping in Phase 1.
- Asset uploads use **signed direct-to-Storage URLs** with a complete callback; videos allowed up to 100 MB.
- With no text and no intake, **voice stays null** rather than being seeded from a made-up default.
- Nav: a new **Clients** group, not a sub-page of Leads.
- Deleting a client deletes its sources, pages, profile versions, products, assets and jobs; the lead
  is untouched.
