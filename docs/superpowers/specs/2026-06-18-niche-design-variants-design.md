# Selectable 3-per-niche HTML designs

**Date:** 2026-06-18
**Status:** Approved (design)
**Topic:** Wire 3 downloaded website designs per niche into the build pipeline, operator-selectable.

---

## Overview

We downloaded 15 finished single-file HTML designs from Google Drive — **3 per niche** for our 5
focus niches (Auto Shops, Chiropractic, Dental, Restaurants, Trades). Today the pipeline supports
exactly **one** `template.html` per niche, token-swapped by
[`html-template-render.ts`](../../../web/lib/pipeline/html-template-render.ts). This spec adds
**operator-selectable design variants**: each niche exposes its 3 designs, the operator picks one
(batch default, overridable per-lead), and the build personalizes the chosen design.

The downloaded files are *finished designs*, not tokenized — each carries a hard-coded placeholder
business name, contact info, reviews, and hours. Integration = (a) a selection mechanism, (b)
tokenizing all 15 to the existing swap contract.

## Goals

- All 3 designs per niche are live and selectable; the pipeline records which design a lead used.
- Operator picks a **batch default** at batch creation and may **override per-lead** before build.
- Every demo is personalized: business name, phone, address, email, **accent color**, **reviews**,
  and **business hours** are injected into all 15 designs.
- Accent color falls back to each design's own hand-tuned hex when the lead has no `brand_color`.
- No regression for in-flight batches/leads (null variant → design #1).

## Non-goals (follow-ups)

- Chromium screenshot thumbnails in the picker (use static HTML preview links for v1).
- Per-design close-rate analytics / A-B attribution.
- Automatic design rotation for cross-lead diversity (operator chooses; no auto-rotation).

---

## 1. Folder layout (variant subfolders)

```
templates/<niche>-site/
├── template.html, defaults.json, partials/    ← existing — kept as last-resort fallback only
└── variants/
    ├── <design-slug-1>/
    │   ├── template.html        (tokenized)
    │   ├── defaults.json        (design's original accent / contact / reviews / hours)
    │   └── partials/{review.html, hours-row.html}   (plain-HTML designs only)
    ├── <design-slug-2>/...
    └── <design-slug-3>/...
```

Niche template slug → design slugs:

| Niche slug (`template_slug`) | Design slugs |
|---|---|
| `auto-site` | `clear-path-auto`, `import-haus`, `ironworks-auto` |
| `chiropractic-site` | `align-chiropractic`, `peak-chiropractic`, `precision-spine-joint` |
| `dental-site` | `bright-dental-co`, `maple-street-family-dental`, `studio-dental` |
| `restaurant-site` | `lume`, `masa`, `the-corner-table` |
| `trades-site` | `basecamp-home-services`, `garrison-and-sons`, `summit-trade-services` |

Source files currently staged in `.tmp/drive-templates/<Niche>/<File>.html`; tokenized copies land
in the `variants/` tree above. The legacy root `template.html` is retained untouched as a fallback.

## 2. Registry — `web/lib/templates/registry.ts`

A **pure data** module (no `import "server-only"`, no db/fs imports) so it is importable by both
the server (stage-3 / API) and client components (the dashboard picker).

```ts
export interface TemplateDesign { slug: string; name: string; }
export const TEMPLATE_DESIGNS: Record<string, TemplateDesign[]> = { /* table above */ };

export function listDesigns(nicheSlug: string): TemplateDesign[];
export function isValidDesign(nicheSlug: string, designSlug: string): boolean;
export function defaultDesign(nicheSlug: string): string | null;  // first entry, or null
```

It is the single source of truth for: stage-3 validation, API zod checks, and the picker UI.

## 3. Database — migration 035

```sql
ALTER TABLE batches ADD COLUMN template_variant text;  -- batch default design slug (nullable)
ALTER TABLE leads   ADD COLUMN template_variant text;  -- per-lead override (nullable = inherit)
```

Both nullable. Semantics: `batches.template_variant` = the batch's default design; `leads.template_variant`
= per-lead override (null = inherit the batch default). Applied via the Supabase SQL editor like prior
migrations. Mirror the new columns into `db/schema.sql`.

## 4. Resolution (pure + testable)

A pure function decides the effective design, with no fs/db access so it unit-tests trivially:

```
resolveDesign(lead, batch) =
    lead.template_variant
    ?? batch.template_variant
    ?? defaultDesign(batch.template_slug)   // registry first entry
```

- Resolved in the **build orchestration layer** (`build-lead.ts` / `improve.ts` / orchestrator — they
  already hold both the lead and batch rows) and passed into `stage-3-generate.ts` as a new optional
  `designSlug` parameter.
- `stage-3` maps `designSlug` → `templates/<template_slug>/variants/<designSlug>/`. If that dir has no
  `template.html`, it falls back to the legacy root `template.html` (current behavior). When `designSlug`
  is omitted, stage-3 self-defaults via `defaultDesign(template_slug)`.
- Existing rows (null variant) deterministically render design #1. No migration backfill needed.

## 5. Tokenization

Two classes, determined per file (a file with `createRoot`/Babel + ~500KB is class B):

### Class A — plain-HTML designs (≈12 files)
Swap to the existing contract consumed by `html-template-render.ts`:
- `{{business_name}}` (every occurrence: title, nav, footer, `og:title`, JSON-LD…)
- `{{phone}}` (display) and `tel:{{phone_tel}}` (href)
- `{{address}}`, `{{email}}` (display) and `{{email_href}}` (mailto)
- `{{accent}}` — the design's primary brand hex; original saved in `defaults.json.accent` (fallback)
- Testimonial card → `{{reviews}}` + `partials/review.html` (`{{stars}}`/`{{review_text}}`/`{{review_author}}`/`{{review_meta}}`)
- Hours block → `{{hours}}` + `partials/hours-row.html` (`{{hours_label}}`/`{{hours_value}}`)
- `defaults.json` captures the design's original accent, phone, address, email, **reviews[]**, and
  **hours[]** so an untouched render is pixel-identical to the shipped design.

`html-template-render.ts` needs **no change** for class A — the `{{reviews}}`/`{{hours}}` blocks are
already opt-in.

### Class B — React/Babel bundles (Ironworks Auto, Studio Dental, Lume + any medium that classifies as B)
Name/contact/accent still tokenize via plain string swap (works inside JS too). Reviews/hours live in
a JS data array, so the HTML-partial path can't apply. Instead:
- Add `{{reviews_json}}` and `{{hours_json}}` tokens **inside the bundle's data object**.
- Extend `html-template-render.ts`: when the source contains `{{reviews_json}}` / `{{hours_json}}`,
  replace with `JSON.stringify(<canonical array>)` — the lead's real reviews/hours mapped to a
  canonical shape (`{stars, text, author, meta}` for reviews; `{label, value}` for hours), or the
  design's defaults when the lead has none.
- The bundle's data object is lightly adjusted to consume the canonical shape. `defaults.json` carries
  the originals so an untouched render matches the shipped design.

## 6. `html-template-render.ts` changes (minimal, additive)

- New optional tokens `{{reviews_json}}` / `{{hours_json}}` → emit `JSON.stringify` of the same
  canonical reviews/hours arrays already computed for the HTML-partial path (real → fallback to
  defaults). Opt-in: only fired when the token is present. Class-A behavior is unchanged.
- Reuse the existing real-vs-default selection logic; factor the "pick reviews source" and "pick hours
  source" steps so both the HTML-block path and the JSON-token path share them.

## 7. Dashboard UI

- **Batch-create form:** when a niche/template is selected, render the 3 designs (name + an "Open
  preview" link) as a radio picker → sets `template_variant` on the create payload. Default = design #1.
- **Lead row / Build control:** a design dropdown (3 options, batch default pre-selected) → sent with
  the Build action as a per-lead override.
- Picker data comes from the pure registry module (client-importable).
- **Previews without Chromium:** copy each design's as-shipped HTML into
  `web/public/template-previews/<niche>/<slug>.html`; the picker links there (opens in a new tab).

## 8. API

- `POST /api/batches` — accept optional `template_variant` (zod), validate with
  `isValidDesign(template_slug, variant)`, persist on the batch row.
- `POST /api/leads/:id/build` — accept optional `template_variant`, validate against the lead's niche,
  persist on the lead row before dispatching the Cloud Run build.
- All responses keep the `{ success, data | error }` envelope.

## 9. Testing (vitest, `npm test`)

- **Registry:** valid/invalid design lookups; `defaultDesign` returns the first entry / null for
  unknown niche.
- **`resolveDesign` precedence:** lead override → batch default → registry default → null.
- **Render smoke test over all 15:** render each tokenized design with a sample lead; assert (a) no
  leftover `{{token}}` remains, (b) the business name appears in the output, (c) output is non-empty,
  (d) each `defaults.json` parses. Catches tokenization mistakes across the whole set.

## 10. Risks

- **Class-B bundles are fragile** — the data object's field names/shape must be matched per bundle;
  the canonical-shape adaptation is the highest-effort, highest-breakage part. Mitigated by the
  per-bundle inspection step and the all-15 render smoke test.
- **Accent swap clash** — a single-hue swap can fight a multi-color design; mitigated by the
  fallback-to-design-default rule (only overrides when the lead actually has a `brand_color`).
- **Medium files (precision-spine-joint 276K, basecamp 204K)** — must be classified A vs B by
  inspection before tokenizing.

## 11. File-by-file change list

| File | Change |
|---|---|
| `templates/<niche>-site/variants/<slug>/…` | New: 15 tokenized designs + defaults.json + partials |
| `web/lib/templates/registry.ts` | New: pure design registry + helpers |
| `web/lib/pipeline/html-template-render.ts` | Add `{{reviews_json}}`/`{{hours_json}}` tokens; factor source-selection |
| `web/lib/pipeline/stage-3-generate.ts` | Accept `designSlug`; resolve `variants/<slug>/`; legacy fallback |
| `web/lib/pipeline/build-lead.ts` (+ improve/orchestrator callers) | Compute `resolveDesign(lead, batch)`, pass `designSlug` |
| `db/migrations/035_template_variant.sql` + `db/schema.sql` | New columns on batches + leads |
| `web/app/api/batches/route.ts` | Accept + validate + persist `template_variant` |
| `web/app/api/leads/[id]/build/route.ts` | Accept + validate + persist per-lead `template_variant` |
| Batch-create form + lead row components | Design picker UI |
| `web/public/template-previews/<niche>/<slug>.html` | Static preview copies |
| Tests under `web/**/*.test.ts` | Registry, resolveDesign, all-15 render smoke |
