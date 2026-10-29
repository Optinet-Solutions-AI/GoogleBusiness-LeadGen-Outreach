# Clients + Brand Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Clients section whose Brand Brain builds a sourced, versioned, editable profile of a business from its website, socials, Google Maps data, demo site and an operator intake form.

**Architecture:** New tables (migration 046) hold clients, sources, crawled pages, profile versions, products, assets and generation jobs. A Cloud Run mode (`brand-brain`) crawls sources, calls Gemini for structured facts, drops anything without a verifiable source, and writes a draft version. Thin routes under `/api/clients` call `lib/clients/*`; dashboard pages under `/clients` are server components with dumb client panels.

**Tech Stack:** Next.js 14 App Router, TypeScript, zod, Supabase (Postgres + Storage), `@google/genai` (Gemini Flash), Playwright on Cloud Run only, vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-brand-brain-design.md`

## Global Constraints

- Every TS file starts with the `CLAUDE.md` header (`<filename> — purpose / Inputs / Outputs / Used by`).
- Route Handlers: `withApi(...)`, `isDbConfigured()` guard, zod-validate the body, call `lib/clients/*`, return `ok(...)` / `fail(msg, status)`.
- Anything touching DB/secrets starts with `import "@/lib/server-guard";`. Client components never import `lib/db` or `lib/services/*`.
- Migration is additive + idempotent; `db/schema.sql` mirrors it. Next migration number: **046**. `leads.stage` untouched.
- Long work only on Cloud Run (`MODE=brand-brain CLIENT_ID=<uuid>`); routes dispatch with `triggerJob` + the `x-vercel-oidc-token` header, with the in-process local fallback copied from `app/api/leads/[id]/build/route.ts`.
- A normal build makes **≤ 3 Gemini calls**. Crawl caps: **25 pages/source**, **2 MB/page**, **10 s/page**, **≤ 30 copied images/source**, **60,000 chars** of page text to Gemini.
- Storage bucket **`client-assets`** (public), object path `<client_id>/<asset_id>.<ext>`. Upload limits: images ≤ **15 MB** (jpg/png/webp), video ≤ **100 MB** (mp4/mov), documents ≤ **20 MB** (pdf).
- No fact without a source: validation drops facts whose page id is unknown or whose quote is not found in that page's text (whitespace-normalised, case-insensitive).
- AI builds never overwrite an existing profile: with a profile present they write a `pending_review` version. Featured products ≤ **10**.
- Before each commit: `npm run typecheck`, `npm run lint`, `npm test` (run from `web/`) are clean. Conventional Commits; every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do not update the external PMS (operator said not needed).

## Review Focus

1. **Host variants**: `example.com` ↔ `www.example.com` and `http` ↔ `https` are the same site; link selection must keep those links and drop everything else (Task 4 test).
2. **Quote drift**: Gemini's quote differs from the page text by whitespace, casing or an `&amp;`; validation must still match it, and must drop a quote that is genuinely absent (Task 2 test).
3. **Bad images**: SVG logos are fine for `logo`, but data URIs, tracking pixels (< 200 px) and non-image content types must never become assets (Task 5 test).
4. **Edit race**: the operator saves while a draft is accepted; version numbering must never collide and a stale `expected_version` must be refused with 409 (Task 7 test).
5. **Nothing to crawl**: a client with only the intake form (and maybe Maps) must still build; the prompt input is valid with zero pages (Task 6 test).

---

### Task 1: Migration 046, schema.sql, config

**Files:**
- Create: `db/migrations/046_clients_brand_brain.sql`
- Modify: `db/schema.sql` (append a "clients / brand brain (migration 046)" section before the helpers; add the two new tables to the RLS-disable block)
- Modify: `web/lib/config.ts` (after the Voizo block), `.env.example`

**Interfaces:**
- Produces: tables exactly as spec §8, with these pinned details:
  - `clients.status text not null default 'pilot' check (status in ('pilot','active','paused','churned'))`, `clients.current_version int not null default 0`, `clients.lead_id uuid unique references leads(id) on delete set null`.
  - `client_sources.kind check (kind in ('website','demo_site','facebook','instagram','google_maps','operator'))`, `status text not null default 'new' check (status in ('new','crawled','partial','blocked','failed'))`, `intake jsonb`, unique index `client_sources_unique_idx on (client_id, kind, coalesce(url,''))`.
  - `brand_profiles.written_by check (written_by in ('ai','operator'))`, `state check (state in ('current','superseded','pending_review','discarded'))`, `unique (client_id, version)`, partial unique index `brand_profiles_one_current_idx on (client_id) where state = 'current'`, `job_id uuid`.
  - `brand_assets.kind check (kind in ('logo','photo','video','document'))`, `origin check (origin in ('upload','website','facebook','instagram','google_maps','lead'))`, `status text not null default 'ready' check (status in ('pending','ready'))` (pending = signed URL issued, not completed), `product_id uuid references brand_products(id) on delete set null`.
  - `generation_jobs.status check (status in ('running','done','failed'))`, `cost_usd numeric`, `provider text not null default 'gemini'`.
  - `set_updated_at` triggers on `clients`, `client_sources`, `brand_products`. Indexes on every `client_id`, plus `source_pages(source_id)`.
  - `env.BRAND_BRAIN_MAX_PAGES` (int, default 25) and `env.BRAND_BRAIN_TEXT_BUDGET` (int, default 60000).

- [ ] **Step 1: Write the migration** with the header comment style of `045_voizo_calls.sql` (what it adds, apply command).
- [ ] **Step 2: Apply it locally** against the dev Supabase project: run the SQL in the Supabase SQL editor (or `psql "$SUPABASE_URL" -f db/migrations/046_clients_brand_brain.sql`). Expected: no errors; re-running it is a no-op.
- [ ] **Step 3: Verify** with a one-off node script (scratchpad, `NODE_PATH=web/node_modules`) that `select` on each of the seven tables returns `ok`.
- [ ] **Step 4: Mirror in `db/schema.sql`** and add the two config vars with comments in `config.ts` + `.env.example`.
- [ ] **Step 5: `cd web && npm run typecheck`** → clean. **Commit:** `feat(db): add clients and brand brain tables (migration 046)`

---

### Task 2: Profile types, fact validation, draft merge (pure)

**Files:**
- Create: `web/lib/clients/types.ts`, `web/lib/clients/facts.ts`
- Test: `web/lib/clients/facts.test.ts`

**Interfaces:**
- Produces (`types.ts`, zod + inferred types):
  - `SourceKind`, `ClientStatus`, `FactSource = { kind: SourceKind; url?: string | null; page_id?: string | null; quote?: string | null }`
  - `fact<T>(value: ZodType<T>)` → `{ value: T; source: FactSource; confirmed: boolean }`; `type Fact<T>`
  - `BrandProfileData` with the groups of spec §4.3 (`business`, `voice`, `visuals`, `audiences`, `claims`, `ctas`, `social`) **plus** `products: ProductSnapshot[]`. Every leaf is `Fact<…> | null`; lists are `Fact<…>[]`. `visuals.logo_asset_id: string | null` is a plain string.
  - `ProductSnapshot = { id?: string; name: string; description: string | null; price: string | null; category: string | null; featured: boolean; sort: number; image_asset_ids: string[]; source: FactSource; confirmed: boolean }`
  - `EMPTY_PROFILE: BrandProfileData` (all nulls / empty lists).
  - `ExtractedFact = { path: string; value: unknown; source: string; quote: string | null }` where `source` is a page id, `"operator"` or `"google_maps"`. Paths are dotted (`business.tagline`); list paths end in `[]` (`claims.allowed[]`).
  - `PageRef = { id: string; url: string; text: string }`
- Produces (`facts.ts`):
  - `normalizeForMatch(s: string): string` (decode `&amp;`/`&quot;`/`&#39;`, collapse whitespace, lowercase)
  - `validateFacts(facts: ExtractedFact[], pages: PageRef[]): { kept: ExtractedFact[]; dropped: { fact: ExtractedFact; reason: "unknown_page" | "quote_not_found" | "missing_quote" }[] }` — `operator`/`google_maps` sources need no quote; page sources need a quote found in that page.
  - `assembleProfile(facts: ExtractedFact[], pages: PageRef[]): BrandProfileData` — sets each path from `EMPTY_PROFILE`; `confirmed = source === "operator"`; unknown paths ignored; `source.url` filled from the page.
  - `mergeDraft(current: BrandProfileData, draft: BrandProfileData, paths: string[]): BrandProfileData` — copies the listed paths (whole lists for `[]` paths; `products` by name, case-insensitive) from draft into a copy of current.
  - `diffPaths(a: BrandProfileData, b: BrandProfileData): string[]` — paths whose value differs (used by the draft review UI).

- [ ] **Step 1: Write failing tests** in `facts.test.ts`:
  - `validateFacts keeps a quoted fact whose quote appears in its page` (page text `"Family-run &amp; local since   2004"`, quote `"family-run & local since 2004"` → kept).
  - `validateFacts drops quote_not_found`, `drops unknown_page`, `drops missing_quote for a page source`, `keeps operator and google_maps facts without a quote`.
  - `assembleProfile sets scalar and list paths and marks operator facts confirmed` (`business.tagline` from page p1 → `confirmed:false`, `source.url` = p1 url; `claims.allowed[]` twice → two entries; `claims.forbidden[]` from operator → `confirmed:true`).
  - `mergeDraft copies only the listed paths and matches products by name`.
  - `diffPaths lists changed paths only`.
- [ ] **Step 2: Run** `npx vitest run lib/clients/facts.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts` and `facts.ts` with the signatures above.
- [ ] **Step 4: Run** the test file → PASS.
- [ ] **Step 5: Commit:** `feat(web): add brand profile types and sourced-fact validation`

---

### Task 3: Clients, sources and intake (lib + routes)

**Files:**
- Create: `web/lib/clients/clients.ts`, `web/lib/clients/sources.ts`
- Create: `web/app/api/clients/route.ts`, `web/app/api/clients/[id]/route.ts`, `web/app/api/clients/[id]/sources/route.ts`, `web/app/api/clients/[id]/intake/route.ts`, `web/app/api/leads/[id]/client/route.ts`
- Test: `web/lib/clients/sources.test.ts` (pure part only)

**Interfaces:**
- `clients.ts`:
  - `ClientRow` (all columns of `clients`), `ClientListRow = ClientRow & { source_kinds: SourceKind[]; last_job_at: string | null; cost_usd: number }`
  - `createClient(input: { name: string; website_url?: string | null; lead_id?: string | null; country_code?: string | null }): Promise<ClientRow>` — when `website_url` is given also attaches a `website` source.
  - `createClientFromLead(leadId: string): Promise<{ client: ClientRow; created: boolean }>` — idempotent on `clients.lead_id`; name/country/website from the lead; attaches sources via `autoSourcesForLead`.
  - `listClients(): Promise<ClientListRow[]>`, `getClient(id): Promise<ClientRow | null>`, `updateClient(id, patch: { name?; status?: ClientStatus; notes?; website_url? })`, `deleteClient(id)` (DB cascades; also removes the client's Storage folder, best-effort).
- `sources.ts`:
  - `autoSourcesForLead(lead: { demo_url; website_url; website_kind }): { kind: SourceKind; url: string | null }[]` (pure; tested) — always `google_maps`; `demo_site` when `demo_url`; `website` when `website_kind` is a real site (not social/none/parked); `facebook`/`instagram` when `website_kind` is that social kind.
  - `SourceRow` (all columns of `client_sources`, `intake: IntakeForm | null`).
  - `attachSource(clientId, input: { kind: SourceKind; url?: string | null }): Promise<SourceRow>` (upsert on the unique index), `removeSource(clientId, sourceId)`, `listSources(clientId): Promise<SourceRow[]>`.
  - `IntakeForm` zod: `{ sells: string; customers: string; tone: string[]; tone_note: string; always_mention: string; never_claim: string; cta_kind: "call"|"book"|"message"|"visit"|"website"; cta_target: string; other: string }` (all strings may be empty). `saveIntake(clientId, form: IntakeForm)` upserts the `operator` source with `intake = form`.
- Routes: `GET/POST /api/clients`; `GET/PATCH/DELETE /api/clients/:id` (GET returns `{ client, sources, current_profile_version, draft_version, brain_started_at }`); `POST/DELETE /api/clients/:id/sources` (DELETE body `{ source_id }`); `PUT /api/clients/:id/intake`; `POST /api/leads/:id/client` → `{ client_id, created }`.

- [ ] **Step 1: Write failing test** `sources.test.ts`: `autoSourcesForLead` for (a) a lead with demo_url + real website (`website_kind: "business"`) → `google_maps, demo_site, website`; (b) `website_kind: "instagram"` → `google_maps, instagram` with the url; (c) nothing → `google_maps` only. (Check `WebsiteKind` values in `lib/services/types.ts` / `components/LeadBadges.tsx` and use the real ones.)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `sources.ts` and `clients.ts`. **Step 4: Run** → PASS.
- [ ] **Step 5: Implement the five routes.** `createClientFromLead` returns 404 when the lead is missing; `POST /api/clients` requires `name`.
- [ ] **Step 6: Verify by hand** with the dev server: `curl -X POST localhost:3000/api/clients -d '{"name":"RateUp","website_url":"https://rateupdigital.com"}'` → `success:true` with a client id and one `website` source; `POST /api/leads/<a lead id>/client` twice → `created:true` then `created:false`, same id.
- [ ] **Step 7: Commit:** `feat(api): add clients, sources and intake routes`

---

### Task 4: HTML → text and crawl link selection (pure)

**Files:**
- Create: `web/lib/clients/crawl/html-to-text.ts`, `web/lib/clients/crawl/page-select.ts`
- Test: `web/lib/clients/crawl/html-to-text.test.ts`, `web/lib/clients/crawl/page-select.test.ts`

**Interfaces:**
- `htmlToText(html: string): { title: string | null; text: string }` — drops `script/style/noscript/svg/nav/footer/header` blocks, keeps headings as lines, paragraphs, list items (`- `), table cells, and any text matching a price (`\$|€|£|USD` + digits); decodes entities; collapses whitespace; max 200,000 chars.
- `CRAWL_KEYWORDS = ["about","service","product","shop","menu","pricing","price","faq","contact","team","review","testimonial","gallery","portfolio","work"]`
- `sameSite(a: URL, b: URL): boolean` — equal hosts ignoring a leading `www.` and ignoring scheme.
- `pickCrawlLinks(homeHtml: string, baseUrl: string, max: number): string[]` — absolute, same-site, deduped (no hash, no query), excluding file extensions (`pdf|jpg|png|zip|…`) and `mailto:/tel:`; ordered: keyword-matching paths/anchor text first (by keyword order), then the rest in document order; returns at most `max - 1` (the home page is the first page).
- `rankPagesForPrompt(pages: { url: string; title: string | null }[]): typeof pages` — home first, then about, services/products/shop/menu, pricing, contact, then the rest in input order.

- [ ] **Step 1: Write failing tests**:
  - `htmlToText strips chrome and keeps headings, paragraphs, list items and prices` (fixture with `<nav>`, `<script>`, `<h1>`, `<li>`, a `$49/mo`).
  - `pickCrawlLinks keeps www/apex and http/https variants, drops other hosts, files, mailto, hash/query duplicates, and puts keyword links first`.
  - `pickCrawlLinks returns at most max-1 links`.
  - `rankPagesForPrompt orders home, about, services, pricing, contact, rest`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (regex-based like `website-images.ts`; no new dependency). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit:** `feat(web): add brand brain html-to-text and crawl link selection`

---

### Task 5: Site + social crawlers, asset copy

**Files:**
- Create: `web/lib/clients/assets.ts`, `web/lib/clients/crawl/crawl-site.ts`, `web/lib/clients/crawl/crawl-social.ts`
- Test: `web/lib/clients/assets.test.ts` (pure helpers)

**Interfaces:**
- `assets.ts`:
  - `AssetOrigin = "upload" | "website" | "facebook" | "instagram" | "google_maps" | "lead"`; `AssetRow` (all columns of `brand_assets`).
  - `ASSETS_BUCKET = "client-assets"`; `ensureAssetsBucket(db)` (idempotent `createBucket`, public).
  - `isCopyableImage(input: { url: string; contentType: string | null; width: number | null; height: number | null; forLogo: boolean }): boolean` (pure, tested): rejects `data:` URLs, non-`image/*`, `image/gif`, and `< 200` px on either side unless `forLogo`; `image/svg+xml` only when `forLogo`.
  - `extFor(contentType: string): string | null` (`image/jpeg→jpg`, `png`, `webp`, `svg+xml→svg`, `video/mp4→mp4`, `video/quicktime→mov`, `application/pdf→pdf`).
  - `copyRemoteImage(input: { clientId: string; url: string; origin: AssetOrigin; kind: "logo" | "photo"; alt?: string | null }): Promise<AssetRow | null>` — fetch via `fetchImageBuffer`, read dimensions (use `sharp` only if already a dependency; otherwise parse PNG/JPEG/WebP headers in a small helper `imageSize(buf): { width; height } | null`), gate with `isCopyableImage`, upload, insert `brand_assets` (`status:'ready'`, `source_url`), return the row. Dedupes on `(client_id, source_url)`.
  - `deleteAsset(clientId, assetId)` — removes the object and the row; nulls `brand_profiles` references are tolerated (not rewritten).
- `crawl-site.ts`: `crawlSite(source: SourceRow, opts: { maxPages: number; client: ClientRow }): Promise<{ pages: number; images: number; status: "crawled" | "partial" | "failed"; brand: { logo_asset_id: string | null; brand_color: string | null } }>` — fetch home (10 s timeout, 2 MB cap, browser UA from `website-images.ts`); if the text is < 200 chars and the headless browser is available (`process.env.PLAYWRIGHT_BROWSERS_PATH` or a `getBrowser()` try/catch), re-render with Playwright; `pickCrawlLinks` → fetch each; **delete the source's old `source_pages` then insert** the new ones; images via `extractWebsiteImages(home)` → `copyRemoteImage` (≤ 30); logo + colour via `extractWebsiteBrand(url)`; `brand.logo_asset_id` = the copied logo asset. Updates the source row (`status`, `page_count`, `last_crawled_at`, `last_error`).
- `crawl-social.ts`: `crawlSocial(source: SourceRow, client: ClientRow): Promise<{ status: "partial" | "blocked" }>` — `fetchSocialPageMeta(url, kind, client.country_code)`; on success copy `og_image` as a `logo` asset (origin = kind) and insert **one** `source_pages` row with `title = og_title` and `text = og_description`; returns `partial`; on null returns `blocked`. Wrap in try/catch so a missing Playwright locally yields `blocked`.

- [ ] **Step 1: Write failing tests** for `isCopyableImage` (five cases from the signature) and `extFor`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `assets.ts`, then the two crawlers. **Step 4: Run** → PASS.
- [ ] **Step 5: Smoke by hand** (scratchpad script with `tsx`): `crawlSite` on the RateUp client's website source → ≥ 3 `source_pages` rows, ≥ 1 asset in `client-assets`, source `status = crawled`. Re-run → same counts (old pages replaced, assets deduped).
- [ ] **Step 6: Commit:** `feat(pipeline): crawl client websites and social pages into brand brain sources`

---

### Task 6: Extraction input, Gemini calls, cost

**Files:**
- Create: `web/lib/clients/extract/prompt.ts`, `web/lib/clients/extract/schema.ts`, `web/lib/clients/cost.ts`, `web/lib/services/gemini-brand.ts`
- Test: `web/lib/clients/extract/prompt.test.ts`, `web/lib/clients/cost.test.ts`

**Interfaces:**
- `prompt.ts` (pure):
  - `ExtractionInput = { intake: IntakeForm | null; maps: MapsFacts | null; pages: { id: string; url: string; title: string | null; text: string }[]; assets: { id: string; alt: string | null; source_url: string | null }[]; language: string | null }`
  - `MapsFacts = { name; category; address; phone; rating; review_count; hours: Record<string,string> | null; reviews: { author; rating; text }[] }` (built from the lead row in Task 8).
  - `buildExtractionInput(raw: ExtractionInput, budget: number): ExtractionInput` — pages via `rankPagesForPrompt`, then each page's text trimmed so the total text ≤ `budget` (earlier pages get their full text until the budget runs out; a page with no room left is dropped).
  - `renderUserPrompt(input: ExtractionInput): string` — labelled sections: `# OPERATOR INTAKE (authoritative)`, `# GOOGLE MAPS`, `# PAGES` (each `## PAGE <id> <url>` + text), `# ASSETS` (id + alt + url). Omits empty sections.
- `schema.ts`: `BRAND_FACTS_SCHEMA` (Gemini `responseSchema`, flat): `{ facts: [{ path, value, source, quote }], products: [{ name, description, price, category, source, quote, image_asset_ids: string[] }] }`; `ExtractionOutput` zod mirror. `VOICE_SCHEMA`: `{ tone: string[]; style_notes: string; do: string[]; dont: string[]; sample_lines: string[] }`.
- `gemini-brand.ts`: `extractBrandFacts(input: ExtractionInput): Promise<{ output: ExtractionOutput; usage: Usage }>`, `extractVoice(input: { passages: string[]; intake: IntakeForm | null; category: string | null }): Promise<{ output: VoiceOutput; usage: Usage }>` where `Usage = { prompt_tokens: number; completion_tokens: number; model: string }` from `resp.usageMetadata`. Same call pattern as `generateStrategy` in `gemini.ts` (`responseMimeType: "application/json"`, `responseSchema`, `temperature: 0.2`, `maxOutputTokens: 8192`). System prompt pins: cite the page id or `operator`/`google_maps` for every fact; copy the supporting quote verbatim; `null`/omit when unsupported; never invent prices, discounts, awards, testimonials or years; at most 10 products; the allowed `path` list (enumerate the scalar and `[]` paths of `BrandProfileData`). On zod failure, retry once with the issues appended to the prompt; then throw.
- `cost.ts`: `GEMINI_FLASH_USD_PER_M = { input: 0.30, output: 2.50 }` (list price; update when it changes); `estimateCostUsd(usage: Usage): number`.

- [ ] **Step 1: Write failing tests**: `buildExtractionInput trims to budget and keeps home + about whole before trimming later pages`; `buildExtractionInput with zero pages and only intake is valid and renders the intake section`; `renderUserPrompt omits empty sections`; `estimateCostUsd(1_000_000 in, 100_000 out) = 0.55`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Live check once** (paid-call rule: one call, operator already approved building RateUp): scratchpad script feeding the RateUp `source_pages` → `extractBrandFacts` returns ≥ 10 facts, each with a `source` and `quote`. Save the raw response to `web/lib/clients/extract/__fixtures__/rateup-extraction.json` for the fixture test in Task 8.
- [ ] **Step 6: Commit:** `feat(web): add brand brain extraction prompt, gemini schema and cost estimate`

---

### Task 7: Profile versions, drafts, product materialisation (lib + routes)

**Files:**
- Create: `web/lib/clients/profile.ts`, `web/app/api/clients/[id]/brain/route.ts`, `web/app/api/clients/[id]/brain/draft/route.ts`, `web/app/api/clients/[id]/brain/versions/[v]/restore/route.ts`
- Test: `web/lib/clients/profile.test.ts` (pure part)

**Interfaces:**
- `class VersionConflictError extends Error` (route → 409).
- `allocateVersion(current: number, expected: number | undefined): number` (pure, tested) — throws `VersionConflictError` when `expected !== undefined && expected !== current`; returns `current + 1`.
- `saveProfileVersion(clientId, data: BrandProfileData, opts: { writtenBy: "ai" | "operator"; state: "current" | "pending_review"; note?: string | null; jobId?: string | null; expectedVersion?: number }): Promise<{ version: number }>` — conditional update `clients.current_version` from `expected` (when given) to `n+1` in one statement (`.eq("current_version", …)`; zero rows → conflict); when `state === "current"` set the previous current to `superseded` and any `pending_review` stays; insert the row.
- `getCurrentProfile(clientId): Promise<{ version: number; data: BrandProfileData } | null>`, `getDraft(clientId)` (latest `pending_review`), `listVersions(clientId): { version; written_by; state; note; created_at }[]`, `getVersion(clientId, v)`.
- `materializeProducts(clientId, products: ProductSnapshot[]): Promise<void>` — upsert rows by `lower(name)`; delete rows not in the snapshot; enforce ≤ 10 featured (extra featured → false, by `sort`).
- `snapshotProducts(clientId): Promise<ProductSnapshot[]>` (rows → snapshot).
- `restoreVersion(clientId, v): Promise<{ version }>` — new operator version with that data + `materializeProducts`.
- `applyDraft(clientId, action: "accept" | "discard" | "merge", paths?: string[]): Promise<{ version: number | null }>` — accept: draft → `current`, old current → `superseded`, materialise products; discard: draft → `discarded`; merge: `mergeDraft(current, draft, paths)` saved as an operator version, draft → `discarded`.
- Routes: `GET /api/clients/:id/brain` → `{ current, draft, diff_paths }`; `PUT` body `{ data, note?, expected_version }` → `saveProfileVersion(... operator, current)` + `materializeProducts(data.products)`; `POST …/draft` body `{ action, paths? }`; `POST …/versions/:v/restore`.

- [ ] **Step 1: Write failing tests**: `allocateVersion(3, 3) = 4`, `allocateVersion(3, 2)` throws `VersionConflictError`, `allocateVersion(3, undefined) = 4`; a pure `capFeatured(products): ProductSnapshot[]` keeps the first 10 featured by `sort`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** lib + routes. **Step 4: Run** → PASS.
- [ ] **Step 5: Verify by hand**: `PUT /api/clients/<id>/brain` with `expected_version: 0` on a client at version 1 → 409; with the right number → version 2; `GET` shows it; `POST …/versions/1/restore` → version 3 equal to 1's data.
- [ ] **Step 6: Commit:** `feat(api): brand profile versions, drafts and restore`

---

### Task 8: Build orchestration, Cloud Run mode, build route

**Files:**
- Create: `web/lib/clients/build-brain.ts`, `web/app/api/clients/[id]/brain/build/route.ts`
- Modify: `web/scripts/cloud-run-job.ts` (add `brand-brain` to `Mode`/`MODES`, header comment, dispatch block)
- Test: `web/lib/clients/build-brain.test.ts` (fixture-based, Gemini mocked)

**Interfaces:**
- `assertBuildable(sources: SourceRow[]): void` (pure) — throws `"Attach at least one source (website, social, Google Maps or the intake form) before building."` when empty.
- `mapsFactsFromLead(lead: LeadRow): MapsFacts` (pure).
- `runBrandBrainBuild(clientId: string, deps?: { extract?: typeof extractBrandFacts; voice?: typeof extractVoice }): Promise<{ version: number; state: "current" | "pending_review"; facts_kept: number; facts_dropped: number; cost_usd: number }>`:
  1. load client + sources; `assertBuildable`; insert `generation_jobs` (`running`).
  2. crawl every `website`/`demo_site` (Task 5) and `facebook`/`instagram`; load `source_pages`; Maps facts from the lead when a `google_maps` source exists; intake from the `operator` source.
  3. `buildExtractionInput` → `extractBrandFacts`; `validateFacts`; `assembleProfile`; tag `demo_site`-page facts with `source.kind = "demo_site"`.
  4. `extractVoice` only when there is page text or an intake; otherwise voice stays null.
  5. products from `output.products` → `ProductSnapshot[]` (source = page/operator; `featured = index < 10`), into `data.products`; `visuals.logo_asset_id` from the crawl.
  6. write the version via `saveProfileVersion` (Task 7) with `written_by:'ai'`, `state` = `current` when the client has no current profile else `pending_review`, `job_id`; when `current`, also materialise products (`materializeProducts`, Task 7).
  7. finish the job row (`done`, tokens, `cost_usd`, `output: { facts_kept, facts_dropped, dropped_reasons }`); on error mark `failed` with `error`, rethrow.
  8. `finally`: `clients.brain_started_at = null`.
- Route `POST /api/clients/:id/brain/build`: `assertBuildable`, set `brain_started_at`, then `triggerJob({ MODE: "brand-brain", CLIENT_ID: id }, { oidcToken })` or the local in-process fallback; returns `202 { status: "building", runner }`. Clears `brain_started_at` when the trigger fails (502).

- [ ] **Step 1: Write failing test** `build-brain.test.ts` (pure pieces only; the orchestration needs the DB): `assertBuildable([])` throws the exact message; `mapsFactsFromLead` maps `business_hours` and `reviews`; and, with the Task 6 fixture plus a saved `pages` fixture, `assembleProfile(validateFacts(fixture.facts, pages).kept, pages)` yields a non-null `business.name` and ≥ 1 `claims.allowed`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `build-brain.ts`, the Cloud Run mode, the route. **Step 4: Run** → PASS.
- [ ] **Step 5: Run the real build locally** from `web/`: `MODE=brand-brain CLIENT_ID=<rateup client id> npm run run:job` → log `job.done` with `version: 1, state: "current"`, a `generation_jobs` row with `cost_usd > 0`, and `brain_started_at` null afterwards.
- [ ] **Step 6: Commit:** `feat(pipeline): build the brand brain on cloud run (MODE=brand-brain)`

---

### Task 9: Products CRUD (lib + routes)

**Files:**
- Create: `web/lib/clients/products.ts`, `web/app/api/clients/[id]/products/route.ts`, `web/app/api/clients/[id]/products/[pid]/route.ts`

**Interfaces:**
- `ProductInput` zod: `{ name: string(min 1); description?; price?; category?; featured?: boolean; image_asset_ids?: string[] }`.
- `createProduct(clientId, input): Promise<ProductRow>` (sort = max+1, `source: { kind: "operator" }`, `confirmed: true`), `updateProduct(clientId, pid, patch)`, `deleteProduct(clientId, pid)`, `reorderProducts(clientId, ids: string[])`.
- Every write ends with `snapshotProducts` → `saveProfileVersion(... operator, note: "products")` (Task 7) so the version history stays truthful. Featured > 10 → `fail("At most 10 featured products", 400)`.
- Routes: `POST /api/clients/:id/products` (create) and `PATCH` with `{ order: string[] }` (reorder); `PATCH/DELETE …/products/:pid`.

- [ ] **Step 1: Implement** lib + routes (no pure logic beyond Task 7's `capFeatured`; no new test file).
- [ ] **Step 2: Verify by hand**: create 11 products with `featured:true` → the 11th returns 400; reorder → `sort` updated; a new version row with note `products` exists.
- [ ] **Step 3: Commit:** `feat(api): brand product crud`

---

### Task 10: Asset upload (signed URLs) and delete

**Files:**
- Modify: `web/lib/clients/assets.ts`
- Create: `web/app/api/clients/[id]/assets/route.ts`, `web/app/api/clients/[id]/assets/[aid]/route.ts`, `web/app/api/clients/[id]/assets/[aid]/complete/route.ts`

**Interfaces:**
- `UPLOAD_LIMITS = { image: 15 * 1024 ** 2, video: 100 * 1024 ** 2, document: 20 * 1024 ** 2 }`; `kindForContentType(ct: string): "photo" | "video" | "document" | null` (jpeg/png/webp → photo; mp4/quicktime → video; pdf → document).
- `issueUpload(clientId, input: { filename: string; content_type: string; bytes: number; kind?: "logo" | "photo" }): Promise<{ asset_id; path; signed_url; token }>` — validates type + size, inserts `brand_assets` (`status:'pending'`, `origin:'upload'`), `db.storage.from(ASSETS_BUCKET).createSignedUploadUrl(path)`.
- `completeUpload(clientId, assetId, input: { width?: number | null; height?: number | null }): Promise<AssetRow>` — confirms the object exists (`list` the folder or `createSignedUrl`), sets `public_url` via `getPublicUrl`, `status:'ready'`.
- `setLogo(clientId, assetId)` — sets `visuals.logo_asset_id` through a new operator version.
- Routes: `POST /api/clients/:id/assets` → issue; `POST …/assets/:aid/complete`; `DELETE …/assets/:aid`; `PATCH …/assets/:aid` body `{ set_logo: true }`.
- Browser upload contract (for Task 14): `fetch(signed_url, { method: "PUT", headers: { "content-type": file.type }, body: file })` then call complete.

- [ ] **Step 1: Add tests** to `assets.test.ts` for `kindForContentType` and a pure `checkUploadLimits(kind, bytes): string | null` (error message or null).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Verify by hand** with curl: issue → PUT a small png to the signed URL → complete → the row has a `public_url` that serves the image; a 16 MB image is refused at issue with 400.
- [ ] **Step 6: Commit:** `feat(api): client asset uploads via signed storage urls`

---

### Task 11: Nav + Clients list page

**Files:**
- Modify: `web/lib/nav.ts` (new group `Clients` with `{ href: "/clients", label: "Clients", icon: Briefcase }` between Pipeline and Outreach)
- Create: `web/app/(dashboard)/clients/page.tsx`, `web/components/ClientsTable.tsx`, `web/components/NewClientButton.tsx`

**Interfaces:**
- Page: `export const dynamic = "force-dynamic"`; loads `listClients()` via `safeDb`; `PageHeader` with `NewClientButton` in `actions`; `EmptyState` when none ("No clients yet. Make one from a lead, or add one by name.").
- `ClientsTable({ rows: ClientListRow[] })` — `DataTable` client mode, `storageKey "clients.columnOrder.v1"`, `noun "clients"`, search on name; columns: name (link), status (chip + filter), sources (badges from `source_kinds`), version, last built (`relativeTime`), cost (`$0.00` 2 dp), open chevron; `onRowClick` → `/clients/<id>`.
- `NewClientButton` — modal with name + optional website URL → `POST /api/clients` → toast → `router.push('/clients/<id>')`.

- [ ] **Step 1: Implement** the three files + nav.
- [ ] **Step 2: Verify** in the dev server: `/clients` renders the RateUp client; New client creates and navigates; no console errors. Screenshot with the Playwright scratchpad script (`rateup_tour_done_v1` set).
- [ ] **Step 3: Commit:** `feat(web): clients list page and nav`

---

### Task 12: Client detail: Overview, Intake, History

**Files:**
- Create: `web/app/(dashboard)/clients/[id]/page.tsx`, `web/components/clients/ClientTabs.tsx`, `web/components/clients/ClientOverview.tsx`, `web/components/clients/ClientIntakeForm.tsx`, `web/components/clients/VersionHistory.tsx`

**Interfaces:**
- Page loads in parallel: `getClient`, `listSources`, `getCurrentProfile`, `getDraft`, `listVersions`, products (`snapshotProducts`), assets (`listAssets(clientId)` — add to `assets.ts`), last job (`generation_jobs` latest). `notFound()` when missing. Renders `PageHeader` (name, status chip, "Clients / <id>" breadcrumb) and `ClientTabs` with `tab` from `?tab=` (`overview | brain | products | assets | intake | history`, default overview).
- `ClientOverview({ client, sources, lastJob, hasProfile })` (client component): sources list with kind badge, url, status chip, last crawl, remove; "Add source" (kind select + url); **Build Brand Brain** button → `POST …/brain/build`; disabled while `brain_started_at` is set; polls `GET /api/clients/:id` every 5 s until `brain_started_at` is null, then `router.refresh()`; stale after 20 min (copy the `REBUILD_STALE_MS` pattern from `LeadActions.tsx`). Shows the last job's state, duration, tokens, `cost_usd`, `facts_kept/dropped`, error.
- `ClientIntakeForm({ clientId, initial: IntakeForm | null })` — the seven fields of spec §4.4 (tone as multi-select chips: warm, direct, playful, premium, expert, friendly, plain); `PUT …/intake`; toast.
- `VersionHistory({ clientId, versions, currentVersion })` — table: version, who, state, note, when; **View** (expands the JSON groups read-only) and **Restore** (confirm → `POST …/restore` → refresh).

- [ ] **Step 1: Implement** page + the three panels (Brain/Products/Assets tabs render placeholders until Tasks 13–14).
- [ ] **Step 2: Verify** in the dev server: Overview shows RateUp's sources and last job; Build button spins then settles; Intake saves and reloads with values; History lists versions and Restore creates a new one.
- [ ] **Step 3: Commit:** `feat(web): client detail page with sources, build, intake and history`

---

### Task 13: Brain editor and draft review

**Files:**
- Create: `web/components/clients/BrainEditor.tsx`, `web/components/clients/FactField.tsx`, `web/components/clients/DraftReview.tsx`
- Create: `web/lib/clients/profile-paths.ts` (pure) · Test: `web/lib/clients/profile-paths.test.ts`

**Interfaces:**
- `profile-paths.ts`: `PROFILE_GROUPS: { key: string; label: string; fields: { path: string; label: string; kind: "text" | "textarea" | "list" | "hex" | "hours" | "audiences" | "ctas" }[] }[]` (every editable path of spec §4.3 except `products`); `getPath(data, path)`, `setPath(data, path, value): BrandProfileData` (immutable); `confirmPath(data, path)`, `confirmGroup(data, groupKey)`.
- `FactField({ path, fact, kind, onChange, onConfirm })` — value input per kind, a source chip (kind label; page sources link to `source.url`; hover/click shows the quote), a confirm tick; edited fields become `confirmed: true` with `source.kind = "operator"` **only if** the value changed.
- `BrainEditor({ clientId, current: { version; data }, assets })` — groups as cards, "Confirm all" per group, Save (`PUT …/brain` with `expected_version`); on 409 toast "Someone saved a newer version; reload." and `router.refresh()`.
- `DraftReview({ clientId, current, draft, diffPaths })` — banner on the Brain tab when a draft exists; side-by-side per changed path with "take draft" checkboxes; **Accept all**, **Merge selected**, **Discard** → `POST …/draft`.

- [ ] **Step 1: Write failing tests** for `setPath`/`getPath` on a scalar and a `[]` path, `confirmGroup` marks every fact in the group confirmed and nothing else.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** lib + components. **Step 4: Run** → PASS.
- [ ] **Step 5: Verify** in the dev server on RateUp: edit the tagline → Save → History shows a new operator version and the field shows "operator · confirmed"; trigger a rebuild → the draft banner appears → Merge one field → draft gone, field updated.
- [ ] **Step 6: Commit:** `feat(web): brand brain editor with sourced facts and draft review`

---

### Task 14: Products and Assets panels

**Files:**
- Create: `web/components/clients/ProductsPanel.tsx`, `web/components/clients/AssetsPanel.tsx`, `web/components/clients/AssetPicker.tsx`

**Interfaces:**
- `ProductsPanel({ clientId, products: ProductSnapshot[], assets })` — rows with name, description, price, category, featured toggle (disabled when 10 are featured and this one isn't), image thumbnails + `AssetPicker` (choose from `assets`), move up/down (→ `PATCH …/products { order }`), inline edit → `PATCH …/products/:pid`, add → `POST`, delete with confirm.
- `AssetsPanel({ clientId, assets })` — grid with origin badge, kind, dimensions; drop zone + file input → `POST …/assets` → `PUT` to `signed_url` → `POST …/complete` (image dimensions from an `Image()` load in the browser); progress per file; "Set as logo" (`PATCH …/assets/:aid { set_logo: true }`); delete with confirm.

- [ ] **Step 1: Implement** the three components and wire them into the tabs.
- [ ] **Step 2: Verify** in the dev server: upload a jpg → appears with dimensions; set as logo → Brain tab's logo updates; add a product with that image; toggle featured on 11 products → 11th blocked with a toast.
- [ ] **Step 3: Commit:** `feat(web): client products and assets panels`

---

### Task 15: "Make client" on the lead page

**Files:**
- Create: `web/components/MakeClientButton.tsx`
- Modify: `web/app/(dashboard)/leads/[id]/page.tsx` (load `clients.id` for this lead alongside the lead; render the button under `LeadActions`)

**Interfaces:**
- `MakeClientButton({ leadId, clientId: string | null })` — when `clientId` is null: "Make client" → `POST /api/leads/:id/client` → `router.push('/clients/<client_id>')`; otherwise a link "Open client".

- [ ] **Step 1: Implement** and wire.
- [ ] **Step 2: Verify**: on a no-website lead click Make client → lands on the client with `google_maps` attached; back on the lead the button reads "Open client".
- [ ] **Step 3: Commit:** `feat(web): make a client from a lead`

---

### Task 16: Acceptance runs and docs

**Files:**
- Create: `workflows/build_brand_brain.md`
- Modify: `CLAUDE.md` (How the App Works: a "Clients / Brand Brain" paragraph; Architecture tree: `lib/clients/`, `app/api/clients/…`, `(dashboard)/clients`; Env table: the two vars; Database section: pointer to migration 046; Quick Reference: `MODE=…|brand-brain`, latest migration `046`), `docs/status/<current ISO week>.md` (append a dated block in the two-section plain-English format)

- [ ] **Step 1: Acceptance 1 (RateUp)**: on Cloud Run (deploy with `bash scripts/deploy-cloud-run-job.sh` first), build RateUp from `rateupdigital.com`; the operator edits in the Brain tab and accepts. Record: version numbers, facts kept/dropped, cost, and the edits that were needed, in the status block.
- [ ] **Step 2: Acceptance 2 (no-website lead)**: make a client from a no-website lead, fill the intake, build; the operator accepts after light edits. Record the same.
- [ ] **Step 3: Prompt iteration**: if either run needs more than light edits, adjust the system prompt in `gemini-brand.ts` (and the fixture) and rebuild once; stop when the operator accepts. Every Gemini call is operator-approved (paid-call rule).
- [ ] **Step 4: Write the workflow SOP** (what a client is, sources, build, review draft, confirm, products/assets, costs, the two config vars, Cloud Run mode) and the `CLAUDE.md` edits.
- [ ] **Step 5: `npm run typecheck && npm run lint && npm test`** → clean. **Commit:** `docs(docs): brand brain workflow and claude.md updates`
