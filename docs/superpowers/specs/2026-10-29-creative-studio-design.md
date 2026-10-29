# Design — Creative Studio v1: static posts and approvals (AI Social Autopilot, Phase 2)

**Date:** 2026-10-29 · **Status:** reviewed · builder-check answers folded in (§12) · **Scope:** Phase 2 of
[`../plans/2026-10-28-ai-social-autopilot-plan.html`](../plans/2026-10-28-ai-social-autopilot-plan.html),
building on Phase 1 ([`2026-10-29-brand-brain-design.md`](2026-10-29-brand-brain-design.md), shipped).

Written for a developer who knows this codebase (`CLAUDE.md`) and the Phase 1 code under `web/lib/clients/`.

---

## 1. Intent

Phase 1 gives every client a **Brand Brain**: a sourced, versioned profile with products, claims, tone,
colours, logo and photos. Phase 2 turns that into **a month of branded social posts the operator can
approve and hand to the client**: captions and hashtags per platform, branded images and carousels
rendered from templates (optionally with an AI-generated background), an approval workflow on fixed
versions, and a downloadable pack. Posting itself is still by hand; auto-publishing is Phase 3.

This is the first **sellable** step: a done-for-you monthly content plan for `has_website` leads and
hosting clients.

### Decisions already made (operator)

| Decision | Choice |
|---|---|
| Who runs it | Done-for-you: the operator makes and approves posts from this dashboard. Clients do not log in. |
| Image generation | **OpenAI** (`OPENAI_API_KEY` exists in `.env`). Gemini stays for text. |
| Start from the plan | No further questions; the calls in §11 are the author's. |
| Pilot clients | Semper Fi Heating and Cooling and The Arrogant Butcher (both built in Phase 1 from real websites), plus Fayette and True North. |

## 2. Goals, non-goals, anti-goals

**Goals (Phase 2 is done when all hold)**

1. From a client with a current Brand Brain, the operator can **plan a month**: pick month, platforms and
   cadence, and get 8–16 post concepts proposed from the Brand Brain (products, claims, CTAs, audiences,
   seasonality), each with a template and a target product/claim. The operator edits, removes or adds concepts.
2. Each concept becomes a **creative** with a **version** holding: platform captions + hashtags
   (Instagram, Facebook, LinkedIn), template inputs (headline, subhead, CTA, colours, logo, photos), and
   **rendered PNGs** in 1:1 (1080×1080), 4:5 (1080×1350) and 9:16 (1080×1920). Carousels render 3–5 slides.
3. Images come from **HTML templates** rendered by the headless Chromium already on Cloud Run. The real
   product/brand photo is **never generated or altered**: an optional **OpenAI background** is composed
   behind it by the template.
4. **Every caption claim is grounded**: prices, discounts, awards, years, "since", "licensed", "#1",
   phone numbers and hours in a caption must match the Brand Brain (confirmed facts preferred); otherwise the
   version is flagged and cannot be approved until edited.
5. **Approvals are on fixed versions**: approve / reject / request changes with a note; editing an approved
   version creates a new draft and the approval no longer applies; an audit trail records who did what when.
6. **Cost is logged per AI job** (`generation_jobs`, reusing Phase 1) and shown per creative and per month,
   with an estimate before any paid generation runs.
7. **Pack download**: a ZIP per client-month with every approved render (`YYYY-MM-DD_<slug>_<aspect>.png`,
   `…_slide-N.png` for carousels) plus `captions.csv` and `captions.json`.
8. **Acceptance:** for Semper Fi, the operator plans a month, generates it, approves ≥ 8 posts and downloads the
   pack in **under one hour of wall-clock**, with every approved caption passing the grounding check.

**Non-goals (later phases)**

- Scheduling, OAuth, auto-publishing (Phase 3); video, Reels, TikTok/YouTube (Phase 4); analytics and automatic
  idea generation from performance (Phase 5); reference-inspired creation; client logins/roles/billing (Phase 6).
- A general-purpose design editor. Edits are form fields on template inputs, not a canvas.

**Anti-goals**

- A caption or image with a price, claim, award, year or testimonial that is not in the Brand Brain.
- Regenerating, inpainting or stylising a real product/brand photo.
- Any paid call (Gemini, OpenAI, Chromium render time) triggered without an explicit operator action and a
  shown estimate.
- Marking a post approved whose render files do not exist.

## 3. Constraints

- All `CLAUDE.md` rules (headers, thin routes, `lib/` brain, `server-guard`, zod, typecheck/lint/test, Conventional
  Commits). Migrations: next is **047**; `db/schema.sql` mirrored. `leads.stage` untouched.
- Long work on the Cloud Run job via new `MODE`s; routes dispatch with `triggerJob` + local fallback, same as
  `brain/build`. Chromium exists only on Cloud Run; locally, rendering degrades to a clear error (no silent no-op)
  except in tests, which exercise the pure parts.
- OpenAI Images: model from config `OPENAI_IMAGE_MODEL` (default **`gpt-image-2`** — the key has access to
  `gpt-image-1`, `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2.5-*`; `gpt-image-1` is being retired), quality
  `OPENAI_IMAGE_QUALITY` (default `medium`), one 1024×1024 (or 1024×1536 for portrait) background per creative,
  reused across aspects and slides; cost recorded from `OPENAI_IMAGE_USD_PER_IMAGE` (config, default 0.053 —
  the operator verifies against OpenAI's current price table) in `lib/clients/cost.ts`. Gemini for concepts and captions (Flash, `thinkingBudget: 0`).
- Budget per creative: ≤ 1 Gemini call for copy (+1 retry) and ≤ 1 OpenAI image; per month plan: 1 Gemini call for
  concepts. A "Generate month" of 12 creatives therefore costs roughly 12 × (image ≈ $0.04–0.08 + copy ≈ $0.003).
- Storage: same public bucket `client-assets`, path `<client_id>/creatives/<version_id>/<aspect>[-slide-N].png`.
- New dependency allowed: `jszip` (pack download), justified in the commit. No canvas/image libraries: composition
  happens in the HTML template, rendering in Chromium.
- Phase 1 invariants hold: profile versions/products/assets untouched by this phase except reads; `brand_assets`
  rows for renders use `origin: 'render'` (migration adds it) so they are excluded from the Assets tab's picker.

## 4. The shape of the thing

### 4.1 Content plan (a month)

A **content plan** belongs to a client and a calendar month: `platforms[]` (`instagram`, `facebook`, `linkedin`),
`posts_per_week` (1–5), `status` (`planning` · `generating` · `ready` · `done`), the concepts Gemini proposed
(`concepts jsonb`, editable), and cost to date. "Plan a month" = one Gemini call that returns concepts:

```
concept: { slot_date, platforms[], template_key, kind: image|carousel, title, angle (one line),
           product_id | null, claim_refs[] (paths into the Brand Brain, e.g. claims.allowed[2]),
           cta_kind, hashtags_seed[] }
```

Concepts are spread over the month on the chosen cadence (deterministic slot dates, avoiding duplicates of the
same product within 7 days). The operator edits the list; "Generate" turns each concept into a creative.

### 4.2 Creative and versions

A **creative** is one post (image or carousel) for one slot date and a set of platforms. It has many **versions**;
the latest non-superseded one is shown. A version is immutable once it has a review decision.

```
creative:  client_id · plan_id | null · kind · slot_date · platforms[] · template_key · product_id | null ·
           title · status (draft|rendering|ready|failed) · current_version · created_at
version:   creative_id · version · state (draft|approved|changes_requested|rejected|superseded) ·
           inputs jsonb  — { headline, subhead, cta_text, cta_kind, body?, slides?: [{headline, subhead}],
                             colors {primary, accent, background, text}, logo_asset_id, photo_asset_ids[],
                             background_asset_id | null, background_prompt | null }
           copy jsonb    — { instagram: {caption, hashtags[]}, facebook: {...}, linkedin: {...} }
           grounding jsonb — { ok: bool, issues: [{platform, text, reason}] }
           renders jsonb — [{ aspect: '1:1'|'4:5'|'9:16', slide: n|null, asset_id, public_url, width, height }]
           ai jsonb      — { copy_job_id, image_job_id }   · note · created_at · reviewed_at · reviewed_by
review:    version_id · action (approve|reject|request_changes|edit) · note · actor ('operator') · created_at
```

State rules: `draft` → (approve) `approved` | (request changes) `changes_requested` | (reject) `rejected`.
Any edit of inputs/copy on a non-draft version creates a **new draft version** and marks the old one
`superseded` (approval does not carry over). Approve requires `renders` for every aspect the platforms need
and `grounding.ok`. Only `approved` versions go into the pack.

### 4.3 Templates

HTML files under `web/lib/creatives/templates/<key>/` with `index.html` using `{{tokens}}` (reuse `fillTokens`
from `html-template-render.ts`), one CSS per aspect via a `data-aspect` attribute, and an optional carousel
variant (`slide.html`). Phase 2 ships four:

| key | Use | Inputs |
|---|---|---|
| `product-hero` | one product/service, photo-led | headline, subhead, cta, photo, logo, colours, optional AI background |
| `offer` | promo / seasonal / maintenance plan | headline (offer), subhead (terms from Brand Brain only), cta, logo, colours, background |
| `tip-quote` | expert tip or brand line (no photo needed) | headline (the tip), subhead (why), logo, colours, background |
| `review` | a Google review quote (from `leads.reviews` via the Brand Brain `claims.allowed` or a review fact) | quote, author, stars, logo, colours |

Template rules: brand colours from `visuals.colors` (fallbacks from the category palette logic in
`gemini.ts`'s defaults), logo as `<img>` from the asset URL, product photo `object-fit: cover` inside a fixed
frame (never stretched), text sizes that fit the frame at every aspect (the renderer checks for overflow via a
`data-fit` script and shrinks the headline by steps). Fonts: Google Fonts link for the brand's `visuals.fonts`
when set, else the template default.

### 4.4 Generation pipeline (Cloud Run)

`MODE=creative CREATIVE_ID=…` (one creative) and `MODE=content-plan PLAN_ID=… [ACTION=concepts|generate]`:

1. **Copy** (Gemini, structured output): given the Brand Brain (current version), the concept, platform rules
   (Instagram ≤ 2,200 chars + ≤ 20 hashtags; Facebook plain, few hashtags; LinkedIn professional, ≤ 3 hashtags),
   return `copy` + template `inputs.headline/subhead/cta_text/body`, citing which Brand Brain paths each claim
   uses. Then the **grounding check** (pure): extract prices/percentages/years/phone numbers/"since"/
   "licensed"/"award"/"#1"/"best" phrases from every caption and headline; each must appear (normalised) in the
   Brand Brain's facts (confirmed preferred; unconfirmed allowed but listed) or in the product's price; failures
   go to `grounding.issues` and the version stays un-approvable until edited.
2. **Background** (OpenAI, optional per template/concept): a prompt built from the brand (category, tone,
   colours, "no text, no logos, no people's faces, no product packaging") → one image → stored as a
   `brand_assets` row (`origin: 'render'`, `kind: 'photo'`, tagged `background`) → `inputs.background_asset_id`.
   Skipped when the template has a product photo and the operator left "AI background" off (default on for
   `tip-quote` and `offer`, off for `product-hero` and `review`).
3. **Render**: fill the template, open it in Chromium (`page.setContent`), screenshot each aspect (and each
   slide), upload PNGs, write `renders`. Renders are deterministic for the same inputs, so "Regenerate image"
   re-renders without new AI calls unless the operator asks for a new background.
4. Job rows: `generation_jobs` kinds `content_plan_concepts`, `creative_copy`, `creative_image`
   (provider `openai`), `creative_render` (provider `chromium`, cost 0 but duration logged). The creative's
   `status` goes `rendering` → `ready` | `failed` (`last_error` on the creative).

`content-plan generate` runs the three steps for every concept that has no creative yet, sequentially, with a
per-plan budget guard (stop and mark `failed` items when the plan's estimated cost would exceed the estimate
shown to the operator by > 25 %).

### 4.5 Dashboard

Client page gets a **Posts** tab:

- **Month header**: month picker, plan status, cost this month, "Plan a month" (opens the wizard) and
  **Download pack** (enabled when ≥ 1 approved).
- **Wizard** (Plan a month): month · platforms · posts per week · products to feature (multi-select, default the
  featured ten) · "AI backgrounds" toggle → shows the **estimate** (count × unit prices) → "Propose concepts"
  (1 Gemini call) → editable concept list (title, date, template, product, kind) with add/remove → "Generate N
  posts (≈ $X)" → dispatches `content-plan generate` and shows progress (poll the plan; `status`, done/failed
  counts).
- **Creatives grid**: one card per creative (1:1 thumbnail, date, platforms, state chip, grounding warning
  badge), filters by state/platform; click → **Creative view**.
- **Creative view**: large preview with aspect switcher (and slide switcher); right column: caption editor per
  platform (counts, hashtag chips), template inputs (headline/subhead/CTA/photo picker/background toggle +
  prompt), grounding issues list (click → highlights the phrase), buttons **Regenerate copy** (paid, confirm),
  **Regenerate image** (free re-render / paid new background, labelled), **Save as new version**; review bar:
  **Approve** · **Request changes** (note) · **Reject**; version list with state and notes.
- "Make a post" (single, outside a plan): same creative view starting from a blank concept with a brief field.

All client components stay dumb; every action is a route call.

## 5. API (thin; validate → `lib/creatives/*`)

| Route | Method | Purpose |
|---|---|---|
| `/api/clients/:id/plans` | GET / POST | list plans · create `{ month, platforms, posts_per_week, product_ids?, ai_backgrounds }` → estimate |
| `/api/clients/:id/plans/:pid` | GET / PATCH / DELETE | detail (+ creatives, progress) · edit concepts/cadence · delete (only `planning`) |
| `/api/clients/:id/plans/:pid/concepts` | POST | dispatch `content-plan` `ACTION=concepts` (1 Gemini call) |
| `/api/clients/:id/plans/:pid/generate` | POST | dispatch `content-plan` `ACTION=generate` (paid; body `{ confirmed_estimate_usd }`) |
| `/api/clients/:id/creatives` | GET / POST | list (month/state/platform filters) · create a single creative from a brief |
| `/api/clients/:id/creatives/:cid` | GET / DELETE | detail with versions · delete |
| `/api/clients/:id/creatives/:cid/versions` | POST | new draft version from edited `inputs`/`copy` (runs the grounding check, re-renders) |
| `/api/clients/:id/creatives/:cid/regenerate` | POST | `{ what: "copy" | "render" | "background" }` → dispatch `creative` |
| `/api/clients/:id/creatives/:cid/review` | POST | `{ action: approve | reject | request_changes, note? }` |
| `/api/clients/:id/pack?month=YYYY-MM` | GET | ZIP of approved renders + captions |
| `/api/pricing/creatives?count=&backgrounds=` | GET | estimate helper (no paid calls) |

## 6. Data model (migration `047_creative_studio.sql`)

```
content_plans      id · client_id (fk cascade) · month date · platforms text[] · posts_per_week int ·
                   product_ids uuid[] · ai_backgrounds bool · status · concepts jsonb · estimate_usd numeric ·
                   generating_started_at · last_error · created_at · updated_at · unique (client_id, month)
creatives          id · client_id · plan_id (fk set null) · kind (image|carousel) · slot_date date ·
                   platforms text[] · template_key · product_id (fk set null) · title · status
                   (draft|rendering|ready|failed) · current_version int default 0 · last_error · created_at · updated_at
creative_versions  id · creative_id (fk cascade) · client_id · version int · state (draft|approved|
                   changes_requested|rejected|superseded) · inputs jsonb · copy jsonb · grounding jsonb ·
                   renders jsonb · ai jsonb · note · created_at · reviewed_at · reviewed_by ·
                   unique (creative_id, version); partial unique (creative_id) where state='approved'
creative_reviews   id · version_id (fk cascade) · client_id · action · note · actor · created_at
brand_assets       origin check += 'render'
generation_jobs    kind values documented (no check); provider check += 'openai','chromium' if a check exists
```

RLS disabled like the rest; indexes on every `client_id`, `plan_id`, `creative_id`; `set_updated_at` triggers.

## 7. Config

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI Images (exists in `.env`; must be added to the zod `env`, `.env.example`, and the deploy script's optional secrets so the Cloud Run job gets it) | — |
| `OPENAI_IMAGE_MODEL` | image model | `gpt-image-2` |
| `OPENAI_IMAGE_QUALITY` | `low` / `medium` / `high` | `medium` |
| `OPENAI_IMAGE_USD_PER_IMAGE` | price used for estimates and job cost (gpt-image-2 medium 1024² ≈ $0.053 per OpenAI’s table, Oct 2026) | `0.053` |
| `CREATIVE_MAX_PER_PLAN` | hard cap of creatives per month plan | 20 |
| `CREATIVE_PLAN_BUDGET_USD` | hard cap of AI spend per plan | 5 |

## 8. Testing

- Pure, vitest: slot-date spreading and duplicate-avoidance; the grounding extractor + matcher (prices,
  years, phones, phrases; confirmed vs unconfirmed); platform caption limits; version state transitions
  (approve requires renders + grounding ok; edit → new draft + superseded); pack file naming; estimate maths.
- Fixture tests: a recorded Gemini concepts response and a recorded copy response for Semper Fi.
- Render smoke on Cloud Run (or locally if Chromium is available): each template × each aspect renders without
  text overflow (the `data-fit` check reports none).
- Acceptance (Goal 8) on Semper Fi, timed; the operator approves; numbers recorded in the status file.

## 9. Rollout

1. Migration 047 + schema. 2. `lib/creatives/{types,grounding,slots,cost,templates}` (pure) + tests.
3. Services: `openai-images.ts`, `gemini-creative.ts`. 4. Render pipeline + Cloud Run modes + routes.
5. Pack download. 6. Posts tab: grid + creative view + review bar. 7. Plan-a-month wizard + progress.
8. Acceptance on Semper Fi; docs (workflow, CLAUDE.md, status).

## 10. Left to the builder

- Exact template markup/CSS and the fit-to-frame script; the concept and copy prompt wording; the OpenAI
  background prompt recipe; carousel slide count heuristics; the exact CSV columns beyond
  `date, platform, caption, hashtags, files`; grid/card styling; how "Regenerate" confirms cost.

## 11. Calls made in this document (flag if wrong)

- Platforms in Phase 2: Instagram, Facebook, LinkedIn only (static image posts). TikTok/YouTube wait for video.
- Approvals are operator-only; no client-facing review link yet.
- Backgrounds default ON for `tip-quote`/`offer`, OFF for `product-hero`/`review`.
- Renders are `brand_assets` rows with `origin: 'render'`, hidden from the Assets tab's picker.
- One content plan per client-month; single posts outside a plan are allowed.
- The grounding check blocks approval but not generation; unconfirmed Brand Brain facts are allowed with a notice.
- Pack = approved versions only; file names carry the slot date and a slug of the title.
- A new dependency, `jszip`, for the pack.

## 12. Builder-check answers (author's calls; the operator opted out of questions)

1. **Grounding = pattern floor + cite-and-verify.** The copy call must return, per platform caption and for the
   headline/subhead, `claims_used: [{ text, path }]` naming the Brand Brain path (or product id) each factual phrase
   rests on. The checker (pure) (a) extracts the pattern list of §4.4 and requires each match to appear, normalised,
   in the cited facts or any confirmed fact/product; (b) requires every `claims_used.text` to appear in the value at
   its `path`; (c) flags any caption sentence containing an "unsupported-claim" keyword (`guarantee`, `certified`,
   `award`, `best`, `#1`, `only`, `cheapest`, `free`, `%`, `$`, `since`, `years`, `licensed`, `insured`, `24/7`,
   `same-day`, `family-owned`, `locally`) that has no `claims_used` entry covering it. Uncited free text without those
   keywords passes (accepted limitation, documented). The `review` template's quote and author are checked against the
   review fact's value verbatim.
2. **Edits are async-rendered.** `POST …/versions` creates the draft version synchronously (inputs + copy + grounding
   check), sets `creatives.status = 'rendering'`, and dispatches `MODE=creative ACTION=render` (Cloud Run; in-process
   locally). The UI polls the creative until `ready`/`failed`. Version `state` stays `draft`; a failed render sets
   `creatives.status='failed'` + `last_error` and approval stays blocked (no renders). Version row first, dispatch second.
3. **OpenAI config** per §7; the key reaches Cloud Run through `scripts/deploy-cloud-run-job.sh`'s optional secrets
   (operator redeploys). Estimates use `OPENAI_IMAGE_USD_PER_IMAGE`; the job records the same number per image.
4. **Renders never leak into Phase 1.** `listAssets(clientId, { includeRenders = false })` excludes `origin='render'`
   by default; the Assets tab, `AssetPicker`, `build-brain` and `materializeProducts` all go through it (the plan
   audits each reader). Backgrounds and renders are tagged (`tags: ['background']` / `['render']`).
5. **Budget guard = hard stop at `min(confirmed_estimate × 1.25, CREATIVE_PLAN_BUDGET_USD)`.** Remaining concepts stay
   un-generated (not failed); the plan becomes `ready` with `pending_count > 0`; "Generate" is re-runnable for the
   leftovers with a fresh estimate. Retries are real jobs and count toward spend.
6. **One sequential job per plan, resumable.** The job processes concepts with no creative, or whose creative is
   `failed` / stuck `rendering` (> 15 min); it writes `content_plans.heartbeat_at` after each creative; the route
   dispatches with `timeoutSeconds: 1800`; a plan whose `generating_started_at` is older than 35 min with a stale
   heartbeat counts as not generating. Clicking Generate again resumes.
7. **Fonts are bundled, not fetched.** Two open-licence woff2 families (one sans, one serif) ship under
   `web/lib/creatives/templates/fonts/` and are inlined as data-URI `@font-face` at render time; `visuals.fonts`
   maps to sans or serif. Renders are deterministic and offline.
8. **Aspects:** all three always rendered; approval requires all three. Concepts `PATCH` allowed in `planning` and
   `ready`, blocked in `generating`. A plan can be deleted in `planning`/`ready` when it has no approved versions;
   `done` is a label that can be set back to `ready`. One plan per client-month stays.
