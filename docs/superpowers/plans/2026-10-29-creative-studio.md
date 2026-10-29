# Creative Studio v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a client's Brand Brain, let the operator plan a month of branded social posts, generate captions and template-rendered images (with optional OpenAI backgrounds), approve fixed versions, and download the approved set as a ZIP.

**Architecture:** New tables (migration 047) hold content plans, creatives, immutable creative versions and review events. Pure modules under `lib/creatives/` (slots, grounding, limits, cost, pack, templates) are tested without I/O; `lib/services/gemini-creative.ts` and `openai-images.ts` make the AI calls; `lib/creatives/render.ts` fills HTML templates and screenshots them in Chromium on Cloud Run (`MODE=creative` / `MODE=content-plan`). Thin routes under `/api/clients/:id/{plans,creatives,pack}`; a **Posts** tab on the client page.

**Tech Stack:** Next.js 14, TypeScript, zod, Supabase, `@google/genai` (Gemini Flash), OpenAI Images REST (`gpt-image-2`), Playwright Chromium, `jszip` (new), vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-creative-studio-design.md` (read §4, §5, §6, §12 before any task)

## Global Constraints

- `CLAUDE.md` rules: file header docstring; thin routes (`withApi`, `isDbConfigured`, zod, `ok`/`fail`); `import "@/lib/server-guard"` on DB/secret modules; client components import nothing server-guarded (type imports fine); typecheck + lint + `npm test` clean before every commit; Conventional Commits; every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Migration **047**, additive + idempotent, mirrored in `db/schema.sql`. `leads.stage` untouched.
- Aspects always rendered: `1:1` 1080×1080, `4:5` 1080×1350, `9:16` 1080×1920; carousels 3–5 slides. Platforms: `instagram`, `facebook`, `linkedin`. Caption limits: Instagram ≤ 2,200 chars + ≤ 20 hashtags; LinkedIn ≤ 3 hashtags; Facebook ≤ 5 hashtags.
- Per creative: ≤ 1 Gemini copy call (+1 retry) and ≤ 1 OpenAI image; per plan: 1 Gemini concepts call. Budget hard stop `min(confirmed_estimate × 1.25, CREATIVE_PLAN_BUDGET_USD=5)`; `CREATIVE_MAX_PER_PLAN=20`.
- OpenAI: `OPENAI_IMAGE_MODEL=gpt-image-2`, `OPENAI_IMAGE_QUALITY=medium`, `OPENAI_IMAGE_USD_PER_IMAGE=0.053`. Backgrounds default ON for `tip-quote`/`offer`, OFF for `product-hero`/`review`. The real product/brand photo is never sent to OpenAI or altered.
- Storage: bucket `client-assets`, renders at `<client_id>/creatives/<version_id>/<aspect>[-slide-N].png`, `brand_assets.origin = 'render'`, excluded from Phase 1 readers by default.
- Approval requires all three renders present and `grounding.ok`. Editing a non-draft version creates a new draft and marks the old one `superseded`. Only `approved` versions enter the pack.
- No paid call without an explicit operator action and a shown estimate. Fonts are bundled (no network at render time). No Cloud Run deploy or `git push` by subagents.

## Review Focus

1. **Ungrounded price**: a caption says "from $89" but no Brand Brain fact or product price contains 89 → `grounding.ok=false` with an issue naming the phrase; Approve is refused (Task 3 test, Task 7 test).
2. **Thin product list**: 5 posts/week with only 2 featured products → slot dates spread across the month and no product repeated within 7 days; the surplus concepts fall back to `tip-quote`/`review` templates (Task 2 test).
3. **Long headline**: a 90-character headline on `9:16` → the fit script shrinks it and the render reports no overflow (Task 4 smoke).
4. **Interrupted month**: the job dies after 4 of 12 creatives → re-running Generate creates only the 8 missing ones, never duplicates, and the plan ends `ready` (Task 8 test on the pure selector).
5. **Edit after approval**: editing an approved version yields a new `draft`, the approved one becomes `superseded`, and the pack no longer includes it (Task 7 test, Task 10 test).

---

### Task 1: Migration 047, schema, config, secrets

**Files:**
- Create: `db/migrations/047_creative_studio.sql`
- Modify: `db/schema.sql`, `web/lib/config.ts`, `.env.example`, `scripts/deploy-cloud-run-job.sh` (add `OPENAI_API_KEY` to `OPTIONAL_SECRETS`)

**Interfaces (produces):**
- Tables exactly as spec §6 with these pins: `content_plans.status check in ('planning','generating','ready','done')`, `platforms text[] not null`, `posts_per_week int not null check between 1 and 5`, `product_ids uuid[] not null default '{}'`, `ai_backgrounds bool not null default true`, `concepts jsonb not null default '[]'`, `estimate_usd numeric`, `generating_started_at`, `heartbeat_at`, `pending_count int not null default 0`, `last_error`, `unique (client_id, month)`.
- `creatives.kind check in ('image','carousel')`, `status check in ('draft','rendering','ready','failed')`, `platforms text[] not null`, `template_key text not null`, `current_version int not null default 0`, `concept_index int` (nullable; which plan concept this creative came from), `brief text` (nullable; single posts).
- `creative_versions.state check in ('draft','approved','changes_requested','rejected','superseded')`, `inputs/copy/grounding/renders/ai jsonb not null default '{}'` (`renders` default `'[]'`), `unique (creative_id, version)`, partial unique `creative_versions_one_approved_idx on (creative_id) where state='approved'`, `reviewed_by text`.
- `creative_reviews.action check in ('approve','reject','request_changes','edit')`, `actor text not null default 'operator'`.
- `brand_assets` origin check re-created with `'render'` added (drop + add constraint, idempotent).
- `env`: `OPENAI_API_KEY` (string, default ""), `OPENAI_IMAGE_MODEL` (default `gpt-image-2`), `OPENAI_IMAGE_QUALITY` (`low|medium|high`, default `medium`), `OPENAI_IMAGE_USD_PER_IMAGE` (number, default 0.053), `CREATIVE_MAX_PER_PLAN` (int, default 20), `CREATIVE_PLAN_BUDGET_USD` (number, default 5).

- [ ] **Step 1:** Write the migration (header style of 046; `set_updated_at` triggers on `content_plans`, `creatives`; indexes on every `client_id`, `plan_id`, `creative_id`, `version_id`; RLS disabled).
- [ ] **Step 2:** Mirror in `db/schema.sql`; add config vars + `.env.example` block; add the secret to the deploy script.
- [ ] **Step 3:** `npm run typecheck` clean. **Commit:** `feat(db): add creative studio tables (migration 047)`. The operator applies the SQL in the Supabase SQL editor; the controller verifies the four tables exist before Task 7.

---

### Task 2: Types, slots, limits, cost (pure)

**Files:**
- Create: `web/lib/creatives/types.ts`, `web/lib/creatives/slots.ts`, `web/lib/creatives/limits.ts`, `web/lib/creatives/cost.ts`
- Test: `web/lib/creatives/slots.test.ts`, `limits.test.ts`, `cost.test.ts`

**Interfaces (produces):**
- `types.ts` (zod + types): `Platform = "instagram"|"facebook"|"linkedin"`, `PLATFORMS`, `Aspect = "1:1"|"4:5"|"9:16"`, `ASPECTS` with `ASPECT_SIZE: Record<Aspect,{w,h}>`, `TemplateKey = "product-hero"|"offer"|"tip-quote"|"review"`, `CreativeKind = "image"|"carousel"`, `Concept` (spec §4.1 fields; `slot_date` ISO date), `CreativeInputs` (spec §4.2 `inputs`), `PlatformCopy = { caption: string; hashtags: string[] }`, `CreativeCopy = Partial<Record<Platform, PlatformCopy>>`, `ClaimUse = { text: string; path: string }`, `Grounding = { ok: boolean; issues: { platform: Platform | "inputs"; text: string; reason: string; warning?: boolean }[] }`, `RenderRef = { aspect: Aspect; slide: number | null; asset_id: string; public_url: string; width: number; height: number }`, `VersionState`, `CreativeStatus`, `PlanStatus`.
- `slots.ts`: `monthDates(month: "YYYY-MM"): string[]`; `spreadSlots(month, postsPerWeek: number, count: number): string[]` (evenly spaced weekdays, deterministic); `assignProducts(slots: string[], productIds: string[]): (string|null)[]` (round-robin, no product twice within 7 days; `null` when none fits).
- `limits.ts`: `PLATFORM_LIMITS: Record<Platform,{ maxChars: number; maxHashtags: number }>` (`instagram {2200,20}`, `facebook {2000,5}`, `linkedin {3000,3}`); `checkCaptionLimits(copy: CreativeCopy): { platform: Platform; reason: string }[]`.
- `cost.ts`: `creativeUnitUsd(opts: { background: boolean }): number` = `0.003 + (background ? env.OPENAI_IMAGE_USD_PER_IMAGE : 0)` (read env lazily via a parameter `imageUsd`), `estimatePlanUsd(count: number, backgrounds: number, imageUsd: number): number`, `budgetCapUsd(confirmedEstimate: number, planBudget: number): number` = `min(confirmed × 1.25, planBudget)`.

- [ ] **Step 1: Write failing tests**: `spreadSlots("2026-11", 3, 12)` returns 12 dates in Nov 2026, ≥ 2 days apart, none on weekends; `assignProducts` with 12 slots and 2 products never repeats a product within 7 days and returns `null` where it can't; `checkCaptionLimits` flags 21 Instagram hashtags and a 2,201-char caption; `estimatePlanUsd(12, 8, 0.053)` = `12×0.003 + 8×0.053`; `budgetCapUsd(2, 5)` = 2.5 and `budgetCapUsd(10, 5)` = 5.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Commit:** `feat(web): creative studio types, slot spreading, caption limits and cost`

---

### Task 3: Grounding checker (pure)

**Files:**
- Create: `web/lib/creatives/grounding.ts` · Test: `web/lib/creatives/grounding.test.ts`

**Interfaces:**
- Consumes: `BrandProfileData`, `ProductSnapshot` (`@/lib/clients/types`), `normalizeForMatch` (`@/lib/clients/facts`), `CreativeCopy`, `CreativeInputs`, `ClaimUse`, `Grounding`.
- Produces: `CLAIM_KEYWORDS` (spec §12.1 list), `extractPatterns(text: string): { kind: "price"|"percent"|"year"|"phone"|"keyword"; text: string }[]`, `factCorpus(profile, products): { confirmed: string[]; unconfirmed: string[] }` (all Fact values + product names/descriptions/prices, normalised), `checkGrounding(input: { copy: CreativeCopy; inputs: CreativeInputs; claimsUsed: ClaimUse[]; profile: BrandProfileData; products: ProductSnapshot[]; reviewText?: string | null }): Grounding` implementing §12.1 (a)(b)(c); issue reasons: `"not in brand brain"`, `"cited path does not contain this text"`, `"unsupported claim keyword without citation"`, `"review quote does not match"`. Unconfirmed matches produce `ok: true` plus an issue with reason `"matches an unconfirmed fact"` flagged `warning: true`.

- [ ] **Step 1: Write failing tests** (Review Focus 1 included): "from $89" with no 89 anywhere → `ok:false`, reason "not in brand brain"; "$12.95 a month" with a product price "$12.95" → ok; "since 1971" with a confirmed `business.founded` "1971" → ok; "award-winning" with no citation → `ok:false` reason "unsupported claim keyword…"; `claims_used` text not found at its path → `ok:false`; "family-owned" cited to `claims.allowed[0]` whose value contains it → ok; a value matching only an unconfirmed fact → `ok:true` with a `warning` issue; review quote mismatch → `ok:false`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Commit:** `feat(web): caption grounding check against the brand brain`

---

### Task 4: Templates, fonts, registry, fit script (+ local render smoke)

**Files:**
- Create: `web/lib/creatives/templates/{product-hero,offer,tip-quote,review}/index.html`, `web/lib/creatives/templates/fonts/{Inter-Variable.woff2,SourceSerif4-Variable.woff2}` (OFL/open licence; download once, commit), `web/lib/creatives/templates/fonts.ts`, `web/lib/creatives/templates/index.ts`
- Test: `web/lib/creatives/templates/index.test.ts`

**Interfaces (produces):**
- `TEMPLATES: Record<TemplateKey, { label: string; needsPhoto: boolean; defaultBackground: boolean; supportsCarousel: boolean; inputFields: (keyof CreativeInputs)[] }>`.
- `renderTemplateHtml(key: TemplateKey, inputs: CreativeInputs, ctx: { aspect: Aspect; slide: number | null; logoUrl: string | null; photoUrls: string[]; backgroundUrl: string | null; fonts: { heading: "sans"|"serif"; body: "sans"|"serif" } }): string` — fills `{{tokens}}` with `fillTokens` + `escapeHtml` (`@/lib/pipeline/html-template-render`), inlines the two fonts as data-URI `@font-face` (`fonts.ts: fontFaceCss(): string`), sets `<html data-aspect="…">`, and includes the fit script: `<script>` that, after load, shrinks `.fit` elements' font-size in 4 % steps until `scrollHeight <= clientHeight`, then sets `document.documentElement.dataset.fit = "ok"` or `"overflow"`.
- `templateInputSchema(key): ZodType<CreativeInputs>` (required fields per template; `review` requires `quote`/`author` via `inputs.body` + `subhead`).

- [ ] **Step 1: Write failing tests**: `renderTemplateHtml` for each key × each aspect contains `data-aspect`, the escaped headline, the font-face CSS, the fit script, and no unreplaced `{{`; `TEMPLATES["tip-quote"].defaultBackground === true` and `["product-hero"].defaultBackground === false`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Write the four templates (1080-wide canvases per aspect; photo frame `object-fit: cover`; logo top-left; CTA pill; brand colours via CSS variables; `.fit` on headline/subhead) + registry. **Step 4:** Run → PASS.
- [ ] **Step 5: Local render smoke** (Playwright Chromium is installed locally): scratch script renders every template × aspect with a 90-char headline (Review Focus 3) via `page.setContent` + screenshot to the scratchpad; assert `dataset.fit === "ok"` for all 12 and eyeball the PNGs (Read tool). Fix any template that overflows or looks broken.
- [ ] **Commit:** `feat(web): four post templates with bundled fonts and fit-to-frame`

---

### Task 5: AI services (OpenAI images, Gemini concepts + copy) with fixtures

**Files:**
- Create: `web/lib/services/openai-images.ts`, `web/lib/services/gemini-creative.ts`, `web/lib/creatives/extract/__fixtures__/{semperfi-concepts.json,semperfi-copy.json}`
- Modify: `web/lib/clients/cost.ts` (add `OPENAI_IMAGE_USD_PER_IMAGE` passthrough helper `imageCostUsd(n, imageUsd)`)

**Interfaces (produces):**
- `openai-images.ts`: `isOpenAiConfigured()`, `generateBackground(input: { prompt: string; size: "1024x1024"|"1024x1536"; quality: "low"|"medium"|"high" }): Promise<{ png: Buffer; model: string; usd: number }>` — REST `POST https://api.openai.com/v1/images/generations` with `{ model: env.OPENAI_IMAGE_MODEL, prompt, size, quality, n: 1, output_format: "png" }`, `b64_json` decoded; `usd = env.OPENAI_IMAGE_USD_PER_IMAGE`; throws on non-2xx with the API message; 60 s timeout; no retry on 4xx.
- `backgroundPrompt(brand: { category: string | null; tone: string[]; colors: { primary: string | null; accent: string | null } }, templateKey: TemplateKey): string` (pure): abstract, soft-focus scene matching the trade, "no text, no letters, no logos, no faces, no product packaging, no watermarks", colour words from the hex.
- `gemini-creative.ts`: `proposeConcepts(input: { profile: BrandProfileData; products: ProductSnapshot[]; month: string; slots: string[]; platforms: Platform[]; productIdsBySlot: (string|null)[] }): Promise<{ concepts: Concept[]; usage: Usage }>` (structured output, one call; concepts respect the given slot dates and products; template chosen from `TEMPLATES`; `review` only when a review fact exists); `writeCopy(input: { profile: BrandProfileData; products: ProductSnapshot[]; concept: Concept; platforms: Platform[]; templateKey: TemplateKey; kind: CreativeKind }): Promise<{ copy: CreativeCopy; inputs: Pick<CreativeInputs,"headline"|"subhead"|"cta_text"|"body"|"slides">; claims_used: ClaimUse[]; usage: Usage }>` — same `structuredCall` pattern as `gemini-brand.ts` (retry once on zod failure), system prompt pins: only Brand Brain facts/products, cite every factual phrase in `claims_used` with its path, respect `PLATFORM_LIMITS`, CTA from `ctas`/intake, no prices unless a product price exists.

- [ ] **Step 1:** Unit-test `backgroundPrompt` (contains the negative list and the category) and the zod output schemas with a hand-written valid/invalid object.
- [ ] **Step 2:** Implement both services.
- [ ] **Step 3: Record fixtures (paid, operator-approved):** scratch script loads Semper Fi's current profile + products (client `26530441-acd5-4ad1-9f3a-b6afb3d1618a`), calls `proposeConcepts` for `2026-11`, 3/week (12 slots) → save `semperfi-concepts.json`; calls `writeCopy` for the first concept → save `semperfi-copy.json`; runs `checkGrounding` on it and reports issues; calls `generateBackground` once (`tip-quote`, 1024×1024, medium) → save the PNG to the scratchpad and view it; report the three costs.
- [ ] **Commit:** `feat(pipeline): openai background images and gemini concept/copy services`

---

### Task 6: Render pipeline + render assets

**Files:**
- Create: `web/lib/creatives/render.ts`
- Modify: `web/lib/clients/assets.ts` (`AssetOrigin += "render"`; `listAssets(clientId, opts?: { includeRenders?: boolean })` default excludes `origin='render'`; `storeRenderPng(input: { clientId; versionId; aspect; slide; png: Buffer; tags: string[] }): Promise<AssetRow>` uploads to `<client_id>/creatives/<version_id>/<aspect>[-slide-N].png` with `upsert: true`, inserts/updates a `brand_assets` row `origin:'render', kind:'photo', status:'ready', tags`), and audit every `listAssets` / `brand_assets` reader (`build-brain.ts`, `profile.ts` `linkProductAssets`/`snapshotProducts`, `products.ts`, the Assets/Products panels' loaders in `page.tsx`) so renders and backgrounds never appear — add `.neq("origin","render")` where a reader queries `brand_assets` directly.

**Interfaces (produces):**
- `renderVersion(input: { clientId: string; versionId: string; creative: { kind: CreativeKind; template_key: TemplateKey }; inputs: CreativeInputs; assets: AssetRow[] }): Promise<{ renders: RenderRef[]; overflow: { aspect: Aspect; slide: number | null }[] }>` — resolves logo/photo/background URLs from `assets`, `renderTemplateHtml` per aspect (× slides for carousels: `inputs.slides.length`, 3–5), Chromium `page.setContent(html, { waitUntil: "load" })` at the aspect's viewport (`deviceScaleFactor: 1`), waits for `dataset.fit`, screenshots PNG, `storeRenderPng`, returns refs; throws a clear error when `getBrowser()` fails (no silent no-op).

- [ ] **Step 1:** Unit-test `listAssets` filtering semantics via a pure helper `excludeRenders(rows)` and the storage path builder `renderPath(clientId, versionId, aspect, slide)` (`…/9:16-slide-2.png` → use `9x16` in file names: `renderPath` maps `:` → `x`).
- [ ] **Step 2:** Implement + audit the readers (list each file touched in the report).
- [ ] **Step 3: Local smoke:** render one fake version for Semper Fi with the `tip-quote` template and no background → 3 PNGs land in the bucket under the right path, `brand_assets` rows have `origin:'render'`, and `GET /api/clients/:id` Assets data (via `listAssets`) does NOT include them. Delete the smoke rows/objects afterwards.
- [ ] **Commit:** `feat(pipeline): render creative versions in chromium and store them as render assets`

---

### Task 7: Plans + creatives + versions + reviews (lib)

**Files:**
- Create: `web/lib/creatives/plans.ts`, `web/lib/creatives/creatives.ts`, `web/lib/creatives/state.ts` (pure)
- Test: `web/lib/creatives/state.test.ts`

**Interfaces (produces):**
- `state.ts` (pure): `canApprove(v: { state; renders: RenderRef[]; grounding: Grounding }, required: Aspect[]): { ok: boolean; reason?: string }`; `nextStateForReview(state: VersionState, action): VersionState | Error`; `editCreatesDraft(state): boolean` (`true` for everything but `draft`).
- `plans.ts`: `PlanRow`; `createPlan(clientId, input: { month; platforms; posts_per_week; product_ids?; ai_backgrounds })` → row with `estimate_usd` from Task 2 (count = min(slots, `CREATIVE_MAX_PER_PLAN`)); `getPlan(clientId, planId)` (+ `creatives` summary counts: total/ready/failed/approved/pending); `listPlans(clientId)`; `updatePlanConcepts(clientId, planId, concepts: Concept[])` (allowed in `planning`/`ready` only → else `PlanStateError`); `deletePlan` (only `planning`/`ready` with no approved versions); `setPlanStatus`, `touchHeartbeat`, `isPlanGenerating(row): boolean` (started < 35 min ago and heartbeat < 15 min ago).
- `creatives.ts`: `CreativeRow`, `VersionRow`; `createCreativeFromConcept(clientId, planId, concept)`; `createSingleCreative(clientId, input: { title; brief; template_key; kind; platforms; slot_date?; product_id? })`; `CreativeListRow = CreativeRow & { latest: Pick<VersionRow,'version'|'state'|'grounding'|'renders'> | null }`; `listCreatives(clientId, filter: { month?; state?; platform? }): Promise<CreativeListRow[]>` (joined with the latest non-superseded version); `getCreative(clientId, cid)` (+ all versions + reviews); `deleteCreative`; `newVersion(clientId, cid, patch: { inputs?; copy?; note? }, opts: { grounding: Grounding })` → inserts `draft` version N+1, marks the previous non-superseded version `superseded` when it was not `draft` (writes an `edit` review), sets `creatives.current_version`; `setVersionAi/Copy/Renders(...)` helpers used by Task 8; `reviewVersion(clientId, cid, version, action, note)` → `canApprove` on approve, state transition, `creative_reviews` row, `reviewed_at`.

- [ ] **Step 1: Write failing tests** (Review Focus 5): `canApprove` false without the `9:16` render / with `grounding.ok=false`; `nextStateForReview("draft","approve")="approved"`, `("approved","request_changes")` → Error (only drafts are reviewed); `editCreatesDraft("approved")=true`, `("draft")=false`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Manual check** (dev DB; Semper Fi): create a plan for `2026-11` → estimate present; create a single creative; `newVersion` twice → v2 draft, v1 superseded with an `edit` review; `reviewVersion(approve)` on a version without renders → refused.
- [ ] **Commit:** `feat(api): content plans, creatives, immutable versions and reviews`

---

### Task 8: Generation orchestration + Cloud Run modes

**Files:**
- Create: `web/lib/creatives/generate.ts`, `web/lib/creatives/select.ts` (pure)
- Modify: `web/scripts/cloud-run-job.ts` (`creative`, `content-plan` modes)
- Test: `web/lib/creatives/select.test.ts`

**Interfaces (produces):**
- `select.ts` (pure): `conceptsToGenerate(plan: { concepts: Concept[] }, creatives: { concept_index: number; status; updated_at }[], now: Date): number[]` — indexes with no creative, or whose creative is `failed`, or `rendering` for > 15 min (Review Focus 4), using `creatives.concept_index` (Task 1).
- `generate.ts`: `runCreative(creativeId: string, action: "all"|"copy"|"background"|"render")`: loads creative + latest version + Brand Brain (current) + products + assets (`includeRenders: true` for its own background); `copy` → `writeCopy` + `checkGrounding` → `generation_jobs` row (`kind:'creative_copy'`); `background` → `backgroundPrompt` + `generateBackground` → `storeRenderPng`-like save tagged `background` (`origin:'render'`) → job row (`kind:'creative_image'`, `provider:'openai'`, `cost_usd`); `render` → `renderVersion` → job row (`kind:'creative_render'`, `provider:'chromium'`, cost 0); sets `creatives.status` `rendering`→`ready`/`failed` (+`last_error`); `all` = copy → background (if `inputs.background_prompt`/template default and `plan.ai_backgrounds`) → render. `runPlan(planId, action: "concepts"|"generate")`: `concepts` → `spreadSlots` + `assignProducts` + `proposeConcepts` → `content_plans.concepts` + job row (`kind:'content_plan_concepts'`); `generate` → sets `generating` + `generating_started_at`, iterates `conceptsToGenerate` sequentially, creating the creative (`createCreativeFromConcept` with `concept_index`) then `runCreative(id,"all")`, `touchHeartbeat` after each, stops at the budget cap (`budgetCapUsd(plan.estimate_usd, env.CREATIVE_PLAN_BUDGET_USD)` vs spent this run), ends with `status:'ready'`, `pending_count`, `last_error`; `finally` clears `generating_started_at`.

- [ ] **Step 1: Write failing tests** for `conceptsToGenerate` (missing, failed, stale rendering, fresh rendering excluded, ready excluded).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement + the two Cloud Run modes (`CREATIVE_ID`/`ACTION`, `PLAN_ID`/`ACTION`). **Step 4:** Run → PASS.
- [ ] **Step 5: Live run (paid, operator-approved):** on the Semper Fi plan from Task 7: `MODE=content-plan PLAN_ID=… ACTION=concepts npm run run:job` → 12 concepts; then set `posts_per_week` so only **3** concepts remain (trim `concepts` via `updatePlanConcepts`) and `ACTION=generate` → 3 creatives `ready` with 3 renders each, copy + grounding present, ≤ 3 OpenAI images; report cost and durations.
- [ ] **Commit:** `feat(pipeline): generate creatives and month plans on cloud run`

---

### Task 9: Routes

**Files:**
- Create: `web/app/api/clients/[id]/plans/route.ts`, `plans/[pid]/route.ts`, `plans/[pid]/concepts/route.ts`, `plans/[pid]/generate/route.ts`, `creatives/route.ts`, `creatives/[cid]/route.ts`, `creatives/[cid]/versions/route.ts`, `creatives/[cid]/regenerate/route.ts`, `creatives/[cid]/review/route.ts`, `web/app/api/pricing/creatives/route.ts`

**Interfaces:** spec §5 exactly. Dispatch pattern = `web/app/api/clients/[id]/brain/build/route.ts` (claim-style guard: `generate` refuses 409 when `isPlanGenerating`; `generate` body `{ confirmed_estimate_usd }` must be ≥ the plan's `estimate_usd × 0.9` else 400 "Estimate changed; refresh"). `versions` POST runs `checkGrounding` + `checkCaptionLimits` synchronously then dispatches `creative` `ACTION=render`. `regenerate` body `{ what }` → `copy` (paid) / `render` (free) / `background` (paid). `review` → `reviewVersion`. `pricing/creatives?count=&backgrounds=` → `{ usd }` with no DB.

- [ ] **Step 1:** Implement all routes (thin; zod bodies; 404/400/409 mapping like the Phase 1 routes).
- [ ] **Step 2: Manual check** with curl on the dev server: estimate route; plan create → estimate; concepts dispatch (local fallback) returns 202; generate with a wrong estimate → 400; review approve on a creative without renders → 400 with the `canApprove` reason; review approve on a ready creative → 200.
- [ ] **Commit:** `feat(api): creative studio routes`

---

### Task 10: Pack download

**Files:**
- Create: `web/lib/creatives/pack.ts`, `web/app/api/clients/[id]/pack/route.ts` · Modify: `web/package.json` (+ `jszip`)
- Test: `web/lib/creatives/pack.test.ts`

**Interfaces:** `packFileName(slotDate: string, title: string, aspect: Aspect, slide: number | null): string` (`2026-11-03_fall-tune-up_1x1.png`, `…_slide-2.png`); `captionsCsv(rows: { date; platform; caption; hashtags: string[]; files: string[] }[]): string` (RFC-4180 quoting); `buildPack(entries: { name: string; data: Buffer | string }[]): Promise<Buffer>` (jszip, deflate). Route: approved versions of the month only (Review Focus 5), fetches each render's PNG from Storage, streams `application/zip` with `Content-Disposition: attachment; filename="<client-slug>-<month>.zip"`; 404 when none approved.

- [ ] **Step 1: Write failing tests**: file naming, CSV quoting of commas/quotes/newlines, a pack with two entries unzips to those names.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (justify `jszip` in the commit body). **Step 4:** Run → PASS.
- [ ] **Step 5:** Manual: approve one Semper Fi creative (via the review route), download the pack with curl, unzip, check names + `captions.csv`.
- [ ] **Commit:** `feat(api): download approved posts as a zip pack`

---

### Task 11: Posts tab — month header, grid, cards

**Files:**
- Create: `web/components/clients/PostsTab.tsx`, `web/components/clients/CreativeCard.tsx`, `web/components/clients/MonthHeader.tsx`
- Modify: `web/components/clients/ClientTabs.tsx` (`TAB_IDS += "posts"`, label "Posts"), `web/app/(dashboard)/clients/[id]/page.tsx` (load `listPlans` + `listCreatives({ month })` for `?month=` default current month; render `PostsTab`)

**Interfaces:** `PostsTab({ clientId, month, plan: PlanRow | null, creatives: CreativeListRow[], imageUsd })` → `MonthHeader` (month picker via `?month=`, plan status chip + progress `ready/total`, cost this month, **Plan a month** button (opens Task 13's wizard; until then a disabled placeholder), **Download pack** link to `/api/clients/:id/pack?month=`, enabled when ≥ 1 approved; **Make a post** button → small modal (title, brief, template select, kind, platforms) → `POST …/creatives` → navigates to `?tab=posts&creative=<cid>`) + filters (state, platform) + grid of `CreativeCard` (1:1 thumbnail from the latest version's render or a template placeholder, date, platforms, state chip, grounding warning badge, click → `?tab=posts&creative=<cid>`).

- [ ] **Step 1:** Implement. **Step 2:** Verify in the dev server on Semper Fi (3 creatives from Task 8): screenshot `…/scratchpad/posts-grid.png`, no console errors, filters work, the pack link enables after the approval from Task 10. **Commit:** `feat(web): posts tab with month header and creative grid`

---

### Task 12: Creative view — preview, captions, inputs, grounding, regenerate, review, versions

**Files:**
- Create: `web/components/clients/CreativeView.tsx`, `CaptionEditor.tsx`, `ReviewBar.tsx`, `VersionStrip.tsx`
- Modify: `page.tsx` (when `?creative=` is set, load `getCreative` and render `CreativeView` in place of the grid)

**Interfaces:** `CreativeView({ clientId, creative, versions, reviews, assets, templates })`: preview with aspect/slide switcher (renders from the shown version; "Rendering…" with 5 s polling of `GET …/creatives/:cid` while `status==='rendering'`); `CaptionEditor` per platform (textarea + hashtag chips + live counts vs `PLATFORM_LIMITS`); template inputs form (fields from `TEMPLATES[key].inputFields`; photo picker reusing `AssetPicker`; background toggle + prompt); grounding issues list (warnings vs blockers); buttons **Regenerate copy** (confirm "≈ $0.003"), **New background** (confirm "≈ $<imageUsd>"), **Re-render** (free), **Save as new version** (POST `versions`, disabled when unchanged); `ReviewBar` (Approve disabled with the `canApprove` reason as title; Request changes with note; Reject) → POST `review`; `VersionStrip` (v1…vN with state chips; click to view; notes).

- [ ] **Step 1:** Implement. **Step 2:** Verify on Semper Fi: edit a caption → Save → new draft version, old superseded (Review Focus 5 in the UI); insert "$999 off" → grounding blocker shown, Approve disabled; remove it → approve works; screenshots `creative-view.png`, `creative-grounding.png`; no console errors. **Commit:** `feat(web): creative view with captions, inputs, grounding and review`

---

### Task 13: Plan-a-month wizard + progress

**Files:**
- Create: `web/components/clients/PlanMonthWizard.tsx` · Modify: `MonthHeader.tsx` (wire the button)

**Interfaces:** modal steps: (1) month · platforms · posts/week · products (multi-select from `snapshotProducts`, default featured) · AI backgrounds toggle → live estimate from `/api/pricing/creatives`; (2) **Propose concepts** → POST `concepts`, poll `GET plans/:pid` until `concepts.length > 0` (or `last_error`); editable concept list (title, date, template select, product select, kind, remove, add) → PATCH `plans/:pid`; (3) **Generate N posts (≈ $X)** → POST `generate` with `confirmed_estimate_usd`; progress bar polling `GET plans/:pid` every 5 s (`ready/failed/pending` counts) until not generating; Done → close + refresh. Errors → toasts.

- [ ] **Step 1:** Implement. **Step 2:** Verify on **The Arrogant Butcher** (`3d5e5d21-781b-495d-909a-a019a6484e43`): plan `2026-11`, 2/week (8 posts), backgrounds on → propose → trim to **4** concepts → generate (paid, ≈ $0.25) → 4 ready; screenshots `wizard-concepts.png`, `wizard-progress.png`. **Commit:** `feat(web): plan-a-month wizard with concept review and generation progress`

---

### Task 14: Acceptance on Semper Fi + docs

**Files:**
- Create: `workflows/create_social_posts.md` · Modify: `CLAUDE.md` (How the App Works step; tree entries `lib/creatives/`, `api/clients/[id]/{plans,creatives,pack}`; env rows; migration 047; MODE list; API Routes rows), `docs/status/2026-W44.md` (new dated block)

- [ ] **Step 1: Acceptance (paid, operator-approved; time it):** on Semper Fi, delete the Task 8 test plan, then from the dashboard: Plan a month `2026-11`, 3/week, backgrounds on → propose → generate all 12 → review each, edit at least two, approve ≥ 8 → download the pack. Record wall-clock, total cost (sum of `generation_jobs`), grounding blockers hit, and the operator's edits. Goal 8 = under one hour.
- [ ] **Step 2:** Write the workflow SOP (what a plan/creative/version is; the wizard; grounding rules; approvals; pack; costs; config; Cloud Run modes; local run command via `npm run run:job`; checklist) and the CLAUDE.md + status edits (non-technical "task for today" block).
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` clean. **Commit:** `docs(docs): creative studio workflow, claude.md and status`
