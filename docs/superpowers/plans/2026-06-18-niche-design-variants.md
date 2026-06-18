# Selectable 3-per-niche HTML designs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator choose one of 3 polished HTML designs per niche (batch default + per-lead override); the build personalizes the chosen design.

**Architecture:** Each niche template dir gains a `variants/<design-slug>/` subfolder (Approach A). A pure `registry.ts` is the single source of truth for design lists + resolution. `template_variant` columns on `batches` + `leads` record the choice; `buildLead` resolves the effective design and passes it into stage-3, which renders the matching variant via the existing token-swap (`html-template-render.ts`), extended with `{{reviews_json}}`/`{{hours_json}}` for the 3 React-bundle designs.

**Tech Stack:** TypeScript, Next.js 14 (App Router), Supabase (Postgres), Vitest, Tailwind. Pipeline runs on Node 20 (CLI + Cloud Run job).

## Global Constraints

- Every TS file starts with the required docstring header (`<filename> — <purpose>` + Inputs/Outputs/Used by). Copy the style from neighboring files.
- Pure registry module: NO `import "server-only"`, NO `lib/db`, NO `node:fs` — it is imported by client components.
- API response envelope is always `{ success, data | error }` via `ok()`/`fail()` from `@/lib/response`.
- Do NOT change existing `leads.stage` enum values, `.env` var names, or the pipeline stage interface.
- Five focus template slugs (exact): `trades-site`, `dental-site`, `chiropractic-site`, `restaurant-site`, `auto-site`.
- `tsc --noEmit` clean and `npm test` green before each commit. Run all `web/` commands from `web/`.
- Do NOT push to `main` (push = prod deploy). Commit locally only.
- Conventional Commits: `<type>(<scope>): <summary>`, scopes here: `template`, `pipeline`, `db`, `api`, `web`, `test`.
- Source designs are staged at `.tmp/drive-templates/<Niche>/<File>.html`.

---

## File Structure

| File | Responsibility |
|---|---|
| `web/lib/templates/registry.ts` (new) | Pure design list + `listDesigns`/`isValidDesign`/`defaultDesign`/`resolveDesign` |
| `web/lib/templates/registry.test.ts` (new) | Registry + resolution unit tests |
| `web/lib/pipeline/html-template-render.ts` (modify) | Factor review/hours source selection; add `{{reviews_json}}`/`{{hours_json}}` tokens |
| `web/lib/pipeline/stage-3-generate.ts` (modify) | New optional `designSlug` param → resolve `variants/<slug>/` dir |
| `web/lib/pipeline/build-lead.ts` (modify) | Read `template_variant` from lead+batch, resolve, pass `designSlug` |
| `db/migrations/035_template_variant.sql` (new) + `db/schema.sql` (modify) | `template_variant text` on batches + leads |
| `web/lib/pipeline/orchestrator.ts` (modify) | `CreateBatchInput.template_variant`; insert it |
| `web/app/api/batches/route.ts` (modify) | Accept + validate + forward `template_variant` |
| `web/app/api/leads/[id]/build/route.ts` (modify) | Accept + validate + persist per-lead `template_variant` |
| `templates/<niche>-site/variants/<slug>/…` (new ×15) | Tokenized design + `defaults.json` + (plain-HTML) `partials/` |
| `web/lib/pipeline/template-variants.smoke.test.ts` (new) | Render all 15 tokenized designs; assert no leftover tokens |
| `web/public/template-previews/<niche>/<slug>.html` (new ×15) | As-shipped preview copies for the picker |
| `web/components/NewBatchModal.tsx` (modify) | Batch-default design picker |
| `web/components/LeadActions.tsx` (modify) | Per-lead design override `<select>` |

Phases: **1** Registry+resolution (Tasks 1–2) → **2** Render engine + DB + wiring (Tasks 3–6) → **3** Tokenize designs (Tasks 7–9) → **4** Dashboard (Tasks 10–11).

---

### Task 1: Registry module

**Files:**
- Create: `web/lib/templates/registry.ts`
- Test: `web/lib/templates/registry.test.ts`

**Interfaces:**
- Produces: `interface TemplateDesign { slug: string; name: string }`; `listDesigns(nicheSlug: string): TemplateDesign[]`; `isValidDesign(nicheSlug: string, designSlug: string): boolean`; `defaultDesign(nicheSlug: string): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/templates/registry.test.ts
import { describe, it, expect } from "vitest";
import { TEMPLATE_DESIGNS, listDesigns, isValidDesign, defaultDesign } from "./registry";

describe("template registry", () => {
  it("has exactly 3 designs for each of the 5 focus niches", () => {
    const niches = ["auto-site", "chiropractic-site", "dental-site", "restaurant-site", "trades-site"];
    for (const n of niches) expect(listDesigns(n)).toHaveLength(3);
    expect(Object.keys(TEMPLATE_DESIGNS).sort()).toEqual([...niches].sort());
  });
  it("validates a known design and rejects an unknown one", () => {
    expect(isValidDesign("dental-site", "studio-dental")).toBe(true);
    expect(isValidDesign("dental-site", "nope")).toBe(false);
    expect(isValidDesign("unknown-niche", "studio-dental")).toBe(false);
  });
  it("defaultDesign returns the first slug, or null for unknown niche", () => {
    expect(defaultDesign("dental-site")).toBe("bright-dental-co");
    expect(defaultDesign("unknown-niche")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/templates/registry.test.ts`
Expected: FAIL — "Cannot find module './registry'".

- [ ] **Step 3: Write the registry**

```ts
// web/lib/templates/registry.ts
/**
 * registry.ts — single source of truth for selectable per-niche site designs.
 *
 * Inputs:  none (static data)
 * Outputs: design lists + lookup/validation/resolution helpers
 * Used by: lib/pipeline/stage-3-generate.ts, lib/pipeline/build-lead.ts,
 *          app/api/batches/route.ts, app/api/leads/[id]/build/route.ts,
 *          components/NewBatchModal.tsx, components/LeadActions.tsx
 *
 * CLIENT-SAFE: no server-only / db / fs imports — imported by client components.
 */
export interface TemplateDesign {
  slug: string;
  name: string;
}

/** Niche template slug → its 3 selectable designs (first = default). */
export const TEMPLATE_DESIGNS: Record<string, TemplateDesign[]> = {
  "auto-site": [
    { slug: "clear-path-auto", name: "Clear Path Auto" },
    { slug: "import-haus", name: "Import Haus" },
    { slug: "ironworks-auto", name: "Ironworks Auto" },
  ],
  "chiropractic-site": [
    { slug: "align-chiropractic", name: "Align Chiropractic" },
    { slug: "peak-chiropractic", name: "Peak Chiropractic" },
    { slug: "precision-spine-joint", name: "Precision Spine & Joint" },
  ],
  "dental-site": [
    { slug: "bright-dental-co", name: "Bright Dental Co" },
    { slug: "maple-street-family-dental", name: "Maple Street Family Dental" },
    { slug: "studio-dental", name: "Studio Dental" },
  ],
  "restaurant-site": [
    { slug: "lume", name: "Lume" },
    { slug: "masa", name: "Masa" },
    { slug: "the-corner-table", name: "The Corner Table" },
  ],
  "trades-site": [
    { slug: "basecamp-home-services", name: "Basecamp Home Services" },
    { slug: "garrison-and-sons", name: "Garrison & Sons" },
    { slug: "summit-trade-services", name: "Summit Trade Services" },
  ],
};

export function listDesigns(nicheSlug: string): TemplateDesign[] {
  return TEMPLATE_DESIGNS[nicheSlug] ?? [];
}

export function isValidDesign(nicheSlug: string, designSlug: string): boolean {
  return listDesigns(nicheSlug).some((d) => d.slug === designSlug);
}

export function defaultDesign(nicheSlug: string): string | null {
  return listDesigns(nicheSlug)[0]?.slug ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/templates/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/templates/registry.ts web/lib/templates/registry.test.ts
git commit -m "feat(template): add per-niche design registry"
```

---

### Task 2: Resolution precedence (`resolveDesign`)

**Files:**
- Modify: `web/lib/templates/registry.ts`
- Test: `web/lib/templates/registry.test.ts`

**Interfaces:**
- Consumes: `isValidDesign`, `defaultDesign` (Task 1).
- Produces: `resolveDesign(nicheSlug: string, leadVariant: string | null | undefined, batchVariant: string | null | undefined): string | null` — lead override → batch default → registry default; invalid candidates are skipped.

- [ ] **Step 1: Write the failing test** (append to `registry.test.ts`)

```ts
import { resolveDesign } from "./registry";

describe("resolveDesign precedence", () => {
  it("prefers a valid lead override", () => {
    expect(resolveDesign("dental-site", "studio-dental", "bright-dental-co")).toBe("studio-dental");
  });
  it("falls to batch default when lead override is null", () => {
    expect(resolveDesign("dental-site", null, "studio-dental")).toBe("studio-dental");
  });
  it("falls to registry default when both are null", () => {
    expect(resolveDesign("dental-site", null, null)).toBe("bright-dental-co");
  });
  it("skips an invalid override and uses the next valid source", () => {
    expect(resolveDesign("dental-site", "garbage", "studio-dental")).toBe("studio-dental");
    expect(resolveDesign("dental-site", "garbage", "garbage")).toBe("bright-dental-co");
  });
  it("returns null for an unknown niche", () => {
    expect(resolveDesign("unknown-niche", "x", "y")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/templates/registry.test.ts`
Expected: FAIL — "resolveDesign is not a function".

- [ ] **Step 3: Add `resolveDesign` to `registry.ts`**

```ts
/**
 * Resolve the effective design slug for a build:
 *   lead override → batch default → registry default (first design).
 * Each candidate must be valid for the niche; invalid/stale values are
 * skipped so a renamed design can't break a build. null = niche has no designs.
 */
export function resolveDesign(
  nicheSlug: string,
  leadVariant: string | null | undefined,
  batchVariant: string | null | undefined,
): string | null {
  for (const candidate of [leadVariant, batchVariant]) {
    if (candidate && isValidDesign(nicheSlug, candidate)) return candidate;
  }
  return defaultDesign(nicheSlug);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/templates/registry.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/templates/registry.ts web/lib/templates/registry.test.ts
git commit -m "feat(template): add resolveDesign precedence helper"
```

---

### Task 3: `{{reviews_json}}` / `{{hours_json}}` tokens in the renderer

**Files:**
- Modify: `web/lib/pipeline/html-template-render.ts`
- Test: `web/lib/pipeline/html-template-render.test.ts`

**Interfaces:**
- Consumes: existing `renderHtmlTemplate(lead, templateDir, outDir)`, `fillTokens`, `escapeHtml`.
- Produces: when the template contains `{{reviews_json}}` it is replaced with `JSON.stringify` of the canonical reviews array (`{stars,text,author,meta}[]`); `{{hours_json}}` with the canonical hours array (`{label,value}[]`). Same real→default source as the HTML-block path.

- [ ] **Step 1: Write the failing test** (append a new `describe` to `html-template-render.test.ts`; reuse the `beforeAll` temp dir by adding a second template file)

```ts
describe("JSON tokens for React-bundle designs", () => {
  it("emits a JSON array for {{reviews_json}} and {{hours_json}}", async () => {
    const tplDir = path.join(dir, "tpljson", "partials");
    await fs.mkdir(tplDir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "tpljson", "template.html"),
      `<script>const R={{reviews_json}};const H={{hours_json}};const N="{{business_name}}";</script>`,
    );
    await fs.writeFile(
      path.join(dir, "tpljson", "defaults.json"),
      JSON.stringify({
        accent: "#000",
        reviews: [{ stars: "★★★★★", text: "Default.", author: "A", meta: "Google" }],
        hours: [{ label: "Mon", value: "Closed" }],
      }),
    );
    const out = path.join(dir, "outjson");
    const distDir = await renderHtmlTemplate(
      {
        business_name: "Bundle Co",
        reviews: [{ text: "Real review long enough to pass the filter.", rating: 5, author: "Z" }],
        business_hours: { Mon: "9-5" },
      },
      path.join(dir, "tpljson"),
      out,
    );
    const html = await fs.readFile(path.join(distDir, "index.html"), "utf-8");
    expect(html).toContain('const N="Bundle Co"');
    expect(html).toContain("Real review long enough");        // real review serialized
    expect(html).toContain('"label":"Mon","value":"9-5"');    // real hours serialized
    expect(html).not.toMatch(/\{\{\w+\}\}/);                   // no token survives
    expect(() => JSON.parse(html.match(/const R=(\[.*?\]);/s)![1])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/pipeline/html-template-render.test.ts`
Expected: FAIL — `{{reviews_json}}` survives (regex match) / `const N` assertion fails.

- [ ] **Step 3: Refactor source selection + add JSON tokens in `html-template-render.ts`**

In `renderHtmlTemplate`, BEFORE the `{{reviews}}` block, hoist the canonical sources so both paths share them:

```ts
  // Canonical review/hours sources (real → fallback to defaults). Shared by
  // the HTML-block path (plain-HTML designs) and the JSON-token path (React
  // bundles whose data lives in a JS array, not markup).
  const realReviews = (lead.reviews ?? [])
    .filter((r) => typeof r?.text === "string" && r.text!.trim().length > 15)
    .slice(0, 3)
    .map<DefaultReview>((r) => ({
      stars: stars(r.rating),
      text: r.text!.trim(),
      author: (r.author ?? "Verified customer").trim(),
      meta: "Google review",
    }));
  const reviewsSource: DefaultReview[] = realReviews.length > 0 ? realReviews : defaults.reviews ?? [];

  const hoursSource: DefaultHoursRow[] =
    lead.business_hours && Object.keys(lead.business_hours).length > 0
      ? Object.entries(lead.business_hours).map(([label, value]) => ({ label, value }))
      : defaults.hours ?? [];
```

Then change the existing `{{reviews}}` block to use `reviewsSource` instead of its inline `real`/`source` computation, and the `{{hours}}` block to use `hoursSource` instead of its inline `rows`. (Delete the now-duplicated `const real`, `const source`, and `let rows` logic inside those blocks; map over `reviewsSource`/`hoursSource`.)

Add the JSON-token replacements right after the hours block, before the final scalar pass:

```ts
  // ── JSON tokens (opt-in, React-bundle designs) ─────────────────────────
  if (out.includes("{{reviews_json}}")) {
    out = out.split("{{reviews_json}}").join(JSON.stringify(reviewsSource));
  }
  if (out.includes("{{hours_json}}")) {
    out = out.split("{{hours_json}}").join(JSON.stringify(hoursSource));
  }
```

Update the file's docstring header to mention the JSON tokens.

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd web && npx vitest run lib/pipeline/html-template-render.test.ts`
Expected: PASS — both the original 5 cases and the new JSON-token case (the refactor must not regress the HTML-block behavior).

- [ ] **Step 5: Commit**

```bash
git add web/lib/pipeline/html-template-render.ts web/lib/pipeline/html-template-render.test.ts
git commit -m "feat(pipeline): add {{reviews_json}}/{{hours_json}} render tokens"
```

---

### Task 4: DB migration + schema + createBatch input

**Files:**
- Create: `db/migrations/035_template_variant.sql`
- Modify: `db/schema.sql` (add the two columns to the `batches` and `leads` definitions)
- Modify: `web/lib/pipeline/orchestrator.ts` (`CreateBatchInput` + insert)

**Interfaces:**
- Produces: `batches.template_variant text` (nullable, batch default); `leads.template_variant text` (nullable, per-lead override). `CreateBatchInput.template_variant?: string | null`.

- [ ] **Step 1: Write the migration**

```sql
-- 035_template_variant.sql
-- Operator-selectable site design per niche. Each niche exposes 3 designs
-- (see web/lib/templates/registry.ts). batches.template_variant is the batch
-- default; leads.template_variant overrides it per lead. null = inherit /
-- registry default (first design). Resolved in lib/pipeline/build-lead.ts.

alter table batches add column if not exists template_variant text;
alter table leads   add column if not exists template_variant text;
```

- [ ] **Step 2: Apply it in Supabase**

Run the SQL in the Supabase SQL editor (latest migration is 034). Then mirror the two columns into `db/schema.sql` under the `batches` and `leads` table definitions (add `template_variant text,` next to the other nullable text columns).

- [ ] **Step 3: Thread `template_variant` through `createBatch`**

In `web/lib/pipeline/orchestrator.ts`, add to `CreateBatchInput`:

```ts
  /** Batch-default design slug (see lib/templates/registry.ts). null/undefined
   *  = registry default (first design for the niche). */
  template_variant?: string | null;
```

And in the `.insert({ ... })` object inside `createBatch`, add:

```ts
      template_variant: input.template_variant ?? null,
```

- [ ] **Step 4: Type-check**

Run: `cd web && npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/035_template_variant.sql db/schema.sql web/lib/pipeline/orchestrator.ts
git commit -m "feat(db): add template_variant to batches + leads"
```

---

### Task 5: Resolve + pass `designSlug` into stage-3

**Files:**
- Modify: `web/lib/pipeline/stage-3-generate.ts`
- Modify: `web/lib/pipeline/build-lead.ts`
- Modify: any other `stage3.run(...)` caller (see Step 1)

**Interfaces:**
- Consumes: `resolveDesign`, `defaultDesign` (Tasks 1–2).
- Produces: `stage3.run(lead, templateSlug, overrides?, designSlug?)` — when `designSlug` resolves to an existing `variants/<slug>/template.html`, that dir renders; else falls back to the niche root `template.html`. `buildLead` resolves the design from `lead.template_variant` + `batch.template_variant`.

- [ ] **Step 1: Find every caller**

Run: `cd web && grep -rn "stage3.run\|stage-3-generate" lib scripts --include=*.ts | grep -v ".test."`
Expected: at least `build-lead.ts`; possibly `improve.ts` and `orchestrator.ts`. Each must pass a resolved `designSlug` (or omit it to accept the registry default).

- [ ] **Step 2: Add the param + variant-dir resolution in `stage-3-generate.ts`**

Import the registry at the top:

```ts
import { defaultDesign } from "../templates/registry";
```

Add `template_variant?: string | null;` to the `Lead` interface. Change the signature:

```ts
export async function run(
  lead: Lead,
  templateSlug: string,
  overrides: { copy?: OverrideCopy; photos?: string[] } = {},
  designSlug?: string | null,
): Promise<string> {
```

After the existing block that resolves `templateDir` (and its premium-trades/trades fallback), and BEFORE the `if (await exists(path.join(templateDir, "template.html")))` check, insert:

```ts
  // Prefer a selectable design variant when one exists for this niche.
  // variants/<slug>/ holds a tokenized single-file HTML design; fall back to
  // the niche-root template.html (legacy) when the variant dir is absent.
  const variant = designSlug ?? defaultDesign(resolvedSlug);
  if (variant) {
    const variantDir = path.join(templateDir, "variants", variant);
    if (await exists(path.join(variantDir, "template.html"))) {
      templateDir = variantDir;
      log.info({ lead_id: lead.id, niche: resolvedSlug, design: variant }, "stage_3.design_variant");
    }
  }
```

(The downstream `if (await exists(path.join(templateDir, "template.html")))` HTML-render branch then reads from `templateDir`, which now points at the variant dir. The Astro path is unaffected — premium-trades/trades have no `variants/` and `defaultDesign` returns null for them.)

- [ ] **Step 3: Resolve + pass the design in `build-lead.ts`**

Add the import:

```ts
import { resolveDesign } from "../templates/registry";
```

Extend the batch select and `DbLead`:

```ts
  const { data: batch } = await db
    .from("batches")
    .select("template_slug, template_variant")
    .eq("id", lead.batch_id)
    .single<{ template_slug: string; template_variant: string | null }>();
  const templateSlug = batch?.template_slug ?? "trades";
  const designSlug = resolveDesign(templateSlug, lead.template_variant, batch?.template_variant);
```

Add `template_variant: string | null;` to the `DbLead` interface. Change the stage-3 call:

```ts
    await stage3.run(enriched as unknown as stage3.Lead, templateSlug, {}, designSlug);
```

- [ ] **Step 4: Thread through the other callers found in Step 1**

For each remaining caller (e.g. `improve.ts`, `regenerate`), load the lead's `template_variant` and the batch's `template_variant`, compute `resolveDesign(templateSlug, lead.template_variant, batch.template_variant)`, and pass it as the 4th arg to `stage3.run`. If a caller has no batch handy, pass `resolveDesign(templateSlug, lead.template_variant, null)`.

- [ ] **Step 5: Type-check + full test run**

Run: `cd web && npm run typecheck && npm test`
Expected: typecheck clean; all existing tests pass (no variant dirs exist yet, so `defaultDesign` resolves but the `variants/<slug>/template.html` check misses and falls back to root — behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add web/lib/pipeline/stage-3-generate.ts web/lib/pipeline/build-lead.ts web/lib/pipeline/improve.ts
git commit -m "feat(pipeline): resolve + render selectable design variant in stage-3"
```

---

### Task 6: All-15 render smoke test (the tokenization gate)

This test is written BEFORE the designs are tokenized so each tokenization task in Phase 3 has an objective pass/fail. It is expected to FAIL until the variant dirs exist — that is intended; it goes green design-by-design.

**Files:**
- Create: `web/lib/pipeline/template-variants.smoke.test.ts`

**Interfaces:**
- Consumes: `renderHtmlTemplate` (Task 3), `TEMPLATE_DESIGNS` (Task 1).

- [ ] **Step 1: Write the smoke test**

```ts
// web/lib/pipeline/template-variants.smoke.test.ts
/**
 * template-variants.smoke.test.ts — render every registered design with a
 * sample lead and assert it personalizes cleanly. The gate for Phase-3
 * tokenization: a design passes only when no {{token}} survives, the business
 * name is injected, and defaults.json parses.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderHtmlTemplate } from "./html-template-render";
import { TEMPLATE_DESIGNS } from "../templates/registry";

const TEMPLATES_ROOT = path.resolve(__dirname, "..", "..", "..", "templates");

const SAMPLE = {
  business_name: "Test Business LLC",
  phone: "(555) 123-4567",
  address: "100 Test St, Testville",
  email: "hi@testbiz.example",
  brand_color: "#2266cc",
  reviews: [
    { text: "Genuinely the best service I have received in years, highly recommend.", rating: 5, author: "Sam P." },
  ],
  business_hours: { "Mon–Fri": "9am–5pm", Sat: "10am–2pm" },
};

const cases = Object.entries(TEMPLATE_DESIGNS).flatMap(([niche, designs]) =>
  designs.map((d) => ({ niche, slug: d.slug })),
);

describe("all registered designs render cleanly", () => {
  it.each(cases)("$niche / $slug", async ({ niche, slug }) => {
    const templateDir = path.join(TEMPLATES_ROOT, niche, "variants", slug);
    // defaults.json must parse
    const defaultsRaw = await fs.readFile(path.join(templateDir, "defaults.json"), "utf-8");
    expect(() => JSON.parse(defaultsRaw)).not.toThrow();
    // render
    const out = await fs.mkdtemp(path.join(os.tmpdir(), `tplvar-${slug}-`));
    const distDir = await renderHtmlTemplate(SAMPLE, templateDir, out);
    const html = await fs.readFile(path.join(distDir, "index.html"), "utf-8");
    await fs.rm(out, { recursive: true, force: true });
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("Test Business LLC");
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails (no variants yet)**

Run: `cd web && npx vitest run lib/pipeline/template-variants.smoke.test.ts`
Expected: FAIL for all 15 (ENOENT on `variants/.../defaults.json`). This is the gate; do NOT commit a skip.

- [ ] **Step 3: Commit the test only**

```bash
git add web/lib/pipeline/template-variants.smoke.test.ts
git commit -m "test(template): add all-15 design render smoke gate (red until tokenized)"
```

---

### Task 7: Tokenize the plain-HTML designs (≈12 files)

These are the small/medium designs with literal markup. Apply the **same recipe** to each. The all-15 smoke test (Task 6) is the per-file gate. Work one niche at a time; commit per niche.

**Files (create per design):**
- `templates/<niche>-site/variants/<slug>/template.html`
- `templates/<niche>-site/variants/<slug>/defaults.json`
- `templates/<niche>-site/variants/<slug>/partials/review.html`
- `templates/<niche>-site/variants/<slug>/partials/hours-row.html`

**Classify first.** For each source file in `.tmp/drive-templates/<Niche>/`, run:

`grep -ci "createroot\|babel" "<file>"` — `0` ⇒ plain HTML (this task). `>0` ⇒ React bundle (Task 8). The mediums `precision-spine-joint.html` (276K) and `basecamp-home-services.html` (204K) MUST be classified this way before tokenizing.

**Tokenization recipe (per plain-HTML design):**

- [ ] **Step 1: Copy source to the variant dir**

```bash
mkdir -p "templates/<niche>-site/variants/<slug>/partials"
cp ".tmp/drive-templates/<Niche>/<File>.html" "templates/<niche>-site/variants/<slug>/template.html"
```

- [ ] **Step 2: Read the file and identify the literal placeholder values**

Open `template.html`. Note the placeholder business name, phone (display + `tel:` href), address, email (display + `mailto:` href), the primary accent hex (the brand color used for buttons/headers — usually a CSS `--var` or a repeated hex), the testimonial card markup, and the hours rows.

- [ ] **Step 3: Swap scalar tokens** (literal find/replace within the file)

- Business name (every occurrence — `<title>`, nav, headings, footer, `og:title`, JSON-LD) → `{{business_name}}`
- Phone display → `{{phone}}`; the `tel:` href value → `tel:{{phone_tel}}`
- Address → `{{address}}`
- Email display → `{{email}}`; the `mailto:` href value → `{{email_href}}`
- Primary accent hex → `{{accent}}`

- [ ] **Step 4: Convert the reviews block**

Replace the entire group of testimonial cards with a single `{{reviews}}` token. Put ONE card's markup into `partials/review.html`, replacing its content with `{{stars}}`, `{{review_text}}`, `{{review_author}}`, `{{review_meta}}`.

- [ ] **Step 5: Convert the hours block**

Replace the hours rows with a single `{{hours}}` token. Put ONE row's markup into `partials/hours-row.html` using `{{hours_label}}` and `{{hours_value}}`. If the design has NO hours section, omit `{{hours}}` and `partials/hours-row.html` (the renderer leaves absent tokens alone).

- [ ] **Step 6: Write `defaults.json`**

Capture the design's ORIGINAL values so an untouched render is pixel-identical (matches the shape in `templates/dental-site/defaults.json`):

```json
{
  "accent": "<original hex>",
  "phone": "<original display phone>",
  "phone_tel": "<original digits>",
  "address": "<original address>",
  "email": "<original email>",
  "reviews": [{ "stars": "★★★★★", "text": "<original review 1>", "author": "<author>", "meta": "<meta>" }],
  "hours": [{ "label": "<original label>", "value": "<original value>" }]
}
```

- [ ] **Step 7: Run the smoke test for this design**

Run: `cd web && npx vitest run lib/pipeline/template-variants.smoke.test.ts -t "<slug>"`
Expected: PASS for this slug — "Test Business LLC" present, no `{{token}}` survives, defaults.json parses. If a `{{token}}` survives, you missed a swap; if the business name is absent, a name occurrence wasn't tokenized.

- [ ] **Step 8: Visual check (optional but recommended)**

Open `template.html` in a browser; confirm the design still renders (tokens show literally — that's fine, it confirms no markup broke).

- [ ] **Step 9: Commit per niche** (after all that niche's plain-HTML designs pass)

```bash
git add templates/<niche>-site/variants
git commit -m "feat(template): tokenize <niche> design variants"
```

Repeat Steps 1–9 for every plain-HTML design across the 5 niches.

---

### Task 8: Tokenize the React-bundle designs (Ironworks Auto, Studio Dental, Lume + any medium classified React)

Same goal, different reviews/hours mechanism: the data lives in a JS object, so use the JSON tokens from Task 3.

**Files (per design):** `templates/<niche>-site/variants/<slug>/template.html` + `defaults.json` (NO `partials/` — JSON tokens replace them).

- [ ] **Step 1: Copy source to the variant dir**

```bash
mkdir -p "templates/<niche>-site/variants/<slug>"
cp ".tmp/drive-templates/<Niche>/<File>.html" "templates/<niche>-site/variants/<slug>/template.html"
```

- [ ] **Step 2: Locate the data object in the inlined `<script>`**

Open `template.html`, find the JS that defines the business name, contact, the reviews array, and the hours. It is typically a `const DATA = {...}` / props object inside a Babel `<script type="text/babel">`.

- [ ] **Step 3: Tokenize scalars in the JS**

Replace the business-name string literal with `{{business_name}}` (e.g. `name: "{{business_name}}"`), the phone with `{{phone}}` and any `tel:` with `tel:{{phone_tel}}`, address with `{{address}}`, email with `{{email}}`/`{{email_href}}`, and the primary accent hex with `{{accent}}` (works in JS string and CSS-in-JS alike). Tokenize the name everywhere it ALSO appears in static `<head>` markup (`<title>`, `og:title`).

- [ ] **Step 4: Replace the reviews + hours arrays with JSON tokens**

Replace the reviews array literal with `{{reviews_json}}` (e.g. `const reviews = {{reviews_json}};`) and the hours array literal with `{{hours_json}}`. Ensure the component reads the canonical shapes: reviews `{stars, text, author, meta}`, hours `{label, value}`. Lightly adjust the component's field reads if it used different names (e.g. `r.quote` → `r.text`).

- [ ] **Step 5: Write `defaults.json`**

Same schema as Task 7 Step 6 (`accent`, `phone`, `phone_tel`, `address`, `email`, `reviews[]`, `hours[]`) capturing the bundle's originals. The renderer serializes these via `{{reviews_json}}`/`{{hours_json}}` when the lead has none.

- [ ] **Step 6: Run the smoke test for this design**

Run: `cd web && npx vitest run lib/pipeline/template-variants.smoke.test.ts -t "<slug>"`
Expected: PASS. The test checks the rendered string contains the name + no surviving tokens; it does NOT execute the bundle's JS.

- [ ] **Step 7: Browser check (required for bundles)**

Open the rendered output in a browser and confirm React still mounts (no JS syntax error from the JSON injection). To produce a rendered file quickly: `cd web && npx tsx -e "import('./lib/pipeline/html-template-render').then(m=>m.renderHtmlTemplate({business_name:'Test Business LLC',phone:'(555) 123-4567',address:'100 Test St',email:'hi@test.example',brand_color:'#26c',reviews:[{text:'Great work, very professional and on time.',rating:5,author:'Sam P.'}],business_hours:{'Mon-Fri':'9-5'}}, '../templates/<niche>-site/variants/<slug>', './.tmp/preview-<slug>'))"` then open `web/.tmp/preview-<slug>/dist/index.html`. Confirm the page renders and shows "Test Business LLC".

- [ ] **Step 8: Commit per design**

```bash
git add templates/<niche>-site/variants/<slug>
git commit -m "feat(template): tokenize <slug> React-bundle design"
```

- [ ] **Step 9: Full smoke run (gate for Phase 3)**

Run: `cd web && npx vitest run lib/pipeline/template-variants.smoke.test.ts`
Expected: PASS for all 15.

---

### Task 9: Static preview copies for the picker

**Files:**
- Create: `web/public/template-previews/<niche>/<slug>.html` (×15) — the AS-SHIPPED design (pre-tokenization), so the operator previews a realistic page.

- [ ] **Step 1: Copy each source design (untokenized) into public/**

```bash
cd "c:/Users/User/Desktop/SCRAPING BUSINESS GOOGLE MAP"
# one per design, e.g.:
mkdir -p web/public/template-previews/dental-site
cp ".tmp/drive-templates/Dental/Studio Dental.html" "web/public/template-previews/dental-site/studio-dental.html"
# …repeat for all 15, mapping <Niche>/<File>.html → <niche-slug>/<design-slug>.html
```

- [ ] **Step 2: Verify the count**

Run: `cd "c:/Users/User/Desktop/SCRAPING BUSINESS GOOGLE MAP" && find web/public/template-previews -name "*.html" | wc -l`
Expected: `15`.

- [ ] **Step 3: Commit**

```bash
git add web/public/template-previews
git commit -m "feat(web): add static design preview pages for the picker"
```

---

### Task 10: Batch-default design picker in NewBatchModal

**Files:**
- Modify: `web/components/NewBatchModal.tsx`

**Interfaces:**
- Consumes: `listDesigns`, `defaultDesign` (registry); `templateForNiche` (`@/lib/data/niches`).
- Produces: the POST `/api/batches` body gains `template_variant` when the chosen niche maps to a focus niche with designs.

- [ ] **Step 1: Add imports + derived state**

```ts
import { listDesigns, defaultDesign } from "@/lib/templates/registry";
import { templateForNiche } from "@/lib/data/niches";
```

Inside the component, derive the niche's designs and hold the chosen variant:

```ts
  const nicheTemplateSlug = useMemo(() => templateForNiche(niche), [niche]);
  const designs = useMemo(() => listDesigns(nicheTemplateSlug), [nicheTemplateSlug]);
  const [designVariant, setDesignVariant] = useState<string | null>(null);
  // Reset/auto-default the design whenever the niche's design set changes.
  useEffect(() => {
    setDesignVariant(designs.length ? designs[0].slug : null);
  }, [nicheTemplateSlug, designs]);
```

- [ ] **Step 2: Render a `<Field label="Design">` picker (only when designs exist)**

Place it directly after the City `<Field>`. Use the existing `Field` helper and `INPUT_CLS`:

```tsx
          {designs.length > 0 && (
            <Field
              label="Design"
              hint={
                <span className="text-[10px] text-ink-subtle">
                  {designs.length} designs for this niche — preview opens in a new tab
                </span>
              }
            >
              <select
                value={designVariant ?? ""}
                onChange={(e) => setDesignVariant(e.target.value)}
                className={INPUT_CLS}
              >
                {designs.map((d) => (
                  <option key={d.slug} value={d.slug}>{d.name}</option>
                ))}
              </select>
              {designVariant && (
                <a
                  href={`/template-previews/${nicheTemplateSlug}/${designVariant}.html`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-1 text-[11px] font-semibold text-action underline"
                >
                  Preview “{designs.find((d) => d.slug === designVariant)?.name}”
                </a>
              )}
            </Field>
          )}
```

- [ ] **Step 3: Send `template_variant` in the create body**

In `submit()`, change the `/api/batches` body to include it (only when set):

```ts
      body: JSON.stringify({
        niche,
        city,
        country_code: country,
        scraper,
        limit,
        ...(designVariant ? { template_variant: designVariant } : {}),
      }),
```

- [ ] **Step 4: Type-check + lint**

Run: `cd web && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/components/NewBatchModal.tsx
git commit -m "feat(web): batch-default design picker in New Batch modal"
```

---

### Task 11: Per-lead design override + build route persistence

**Files:**
- Modify: `web/app/api/batches/route.ts` (accept + validate `template_variant`)
- Modify: `web/app/api/leads/[id]/build/route.ts` (accept + validate + persist per-lead override)
- Modify: `web/components/LeadActions.tsx` (override `<select>`, passed to build)

**Interfaces:**
- Consumes: `isValidDesign` (registry); `listDesigns` (for the UI).
- Produces: `POST /api/batches` persists a validated `template_variant`; `POST /api/leads/:id/build` accepts `{ template_variant }` (body), validates against the lead's niche, writes `leads.template_variant` before dispatch.

- [ ] **Step 1: Validate `template_variant` in the batches route**

In `web/app/api/batches/route.ts`, add to the zod `Body`:

```ts
  template_variant: z.string().min(1).optional(),
```

Import the registry and validate after `template_slug` is derived:

```ts
import { isValidDesign } from "@/lib/templates/registry";
// …after: const template_slug = parsed.data.template_slug ?? templateForNiche(parsed.data.niche);
const template_variant =
  parsed.data.template_variant && isValidDesign(template_slug, parsed.data.template_variant)
    ? parsed.data.template_variant
    : null; // ignore an invalid/foreign variant; createBatch falls back to the registry default
```

Pass it through: `await createBatch({ ...parsed.data, template_slug, template_variant });`

- [ ] **Step 2: Persist the per-lead override in the build route**

In `web/app/api/leads/[id]/build/route.ts`, parse an optional body and validate against the lead's niche before dispatch. Add imports:

```ts
import { isValidDesign } from "@/lib/templates/registry";
```

After the `skipIfNotBuildable` gate (which already proves the lead is a focus niche) and before setting `rebuild_started_at`, insert:

```ts
  // Optional per-lead design override. Validate against the lead's niche
  // (via its batch template_slug) and persist; buildLead() resolves the
  // effective design from leads.template_variant + batches.template_variant.
  const body = await req.json().catch(() => null);
  const requestedVariant = typeof body?.template_variant === "string" ? body.template_variant : null;
  if (requestedVariant) {
    const { data: row } = await getDb()
      .from("leads")
      .select("batches(template_slug)")
      .eq("id", params.id)
      .single<{ batches: { template_slug: string } | null }>();
    const nicheSlug = row?.batches?.template_slug ?? "";
    if (isValidDesign(nicheSlug, requestedVariant)) {
      await getDb().from("leads").update({ template_variant: requestedVariant }).eq("id", params.id);
    }
  }
```

(Note: `skipIfNotBuildable` reads via `req`-independent DB calls, so consuming the body here is safe — it is read once. Keep the existing `new URL(req.url)` searchParams read for `refresh-photos`.)

- [ ] **Step 3: Add the override `<select>` in `LeadActions.tsx`**

Read `web/components/LeadActions.tsx`. Add to its local `Lead` interface: `template_variant: string | null;`. The lead detail page that renders `<LeadActions lead={...} buildable={...} />` must also pass the niche's designs — add a prop:

```ts
export function LeadActions({
  lead,
  buildable,
  designs = [],
}: {
  lead: Lead;
  buildable: boolean;
  designs?: { slug: string; name: string }[];
}) {
```

Render a `<select>` next to the Build button (only when `buildable && designs.length > 0`), defaulting to `lead.template_variant ?? designs[0].slug`, stored in local state `selectedDesign`. Change `buildSite()` to send it:

```ts
    const triggered = await fetchJson(`/api/leads/${lead.id}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_variant: selectedDesign }),
    });
```

- [ ] **Step 4: Pass `designs` from the lead detail page**

Find the page rendering `<LeadActions>` (`cd web && grep -rn "LeadActions" app`). It has the lead + batch; pass `designs={listDesigns(batch.template_slug)}` (import `listDesigns` from `@/lib/templates/registry`).

- [ ] **Step 5: Type-check + lint + full test run**

Run: `cd web && npm run typecheck && npm run lint && npm test`
Expected: all clean/green (registry + render + smoke + existing suites).

- [ ] **Step 6: Commit**

```bash
git add web/app/api/batches/route.ts "web/app/api/leads/[id]/build/route.ts" web/components/LeadActions.tsx web/app
git commit -m "feat(api): per-lead design override on build + batch variant validation"
```

---

## Self-Review

**Spec coverage:**
- Folder layout (Approach A) → Tasks 7–8 create `variants/<slug>/`. ✅
- Registry pure module → Task 1. ✅
- DB migration 035 (both tables) → Task 4. ✅
- `resolveDesign` precedence → Task 2; threaded → Task 5. ✅
- Accent swap w/ design-default fallback → already in `html-template-render.ts` (`accent = lead.brand_color ?? defaults.accent`); preserved by Tasks 7–8 writing `defaults.accent`. ✅
- Reviews/hours on all 15: plain-HTML via `{{reviews}}`/`{{hours}}` (Task 7); React bundles via `{{reviews_json}}`/`{{hours_json}}` (Tasks 3 + 8). ✅
- Dashboard batch default + per-lead override → Tasks 10–11. ✅
- API accept/validate/persist → Tasks 4, 11. ✅
- Static previews (no Chromium) → Task 9. ✅
- Tests: registry, resolveDesign, all-15 render smoke → Tasks 1, 2, 6. ✅
- Non-goals (Chromium thumbnails, analytics, auto-rotation) → excluded. ✅

**Placeholder scan:** Tokenization Tasks 7–8 are procedural recipes (the source HTML is only knowable when each file is opened) with literal token names, an exact `defaults.json` schema, and the Task-6 render test as an objective per-file gate — not "TBD". No other placeholders.

**Type consistency:** `resolveDesign(nicheSlug, leadVariant, batchVariant)`, `defaultDesign(nicheSlug)`, `isValidDesign(nicheSlug, designSlug)`, `listDesigns(nicheSlug)` are used identically in Tasks 2/5/10/11. `stage3.run(lead, templateSlug, overrides, designSlug)` matches the caller in Task 5. Canonical review shape `{stars,text,author,meta}` / hours `{label,value}` consistent across Tasks 3, 6, 7, 8.
