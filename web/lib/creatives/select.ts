/**
 * select.ts — pure helpers for creative generation: which concepts still need work, budget check, input seeds.
 *
 * Inputs:  plan concepts, creative status rows, Brand Brain data, product snapshots, asset rows
 * Outputs: concept indexes to (re)generate, budget verdicts, pending counts, seeded/complete CreativeInputs,
 *          the concept a creative is written from, the review fact a review quote is checked against
 * Used by: lib/creatives/generate.ts (runPlan / runCreative), unit tests
 */
import { normalizeForMatch } from "@/lib/clients/facts";
import type { BrandProfileData, ProductSnapshot } from "@/lib/clients/types";
import { creativeUnitUsd } from "./cost";
import { TEMPLATES } from "./templates/registry";
import type { Concept, CreativeInputs, CreativeKind, CreativeStatus, Platform, TemplateKey } from "./types";

/** A creative stuck in `rendering` longer than this is treated as abandoned (spec §12.6). */
export const STALE_RENDERING_MS = 15 * 60_000;

type CreativeState = { concept_index: number | null; status: CreativeStatus; updated_at: string };

/** Healthy = done (`ready`) or being worked on right now (`rendering`, updated within 15 min). */
function isHealthy(c: CreativeState, now: Date): boolean {
  if (c.status === "ready") return true;
  if (c.status === "rendering") return now.getTime() - Date.parse(c.updated_at) <= STALE_RENDERING_MS;
  return false; // failed, or a draft that was created but never started
}

/**
 * Concept indexes a Generate run should process: no creative yet, or every creative for it is
 * failed / a never-started draft / stuck `rendering` for > 15 min. Ascending order.
 */
export function conceptsToGenerate(plan: { concepts: Concept[] }, creatives: CreativeState[], now: Date): number[] {
  const out: number[] = [];
  for (let i = 0; i < plan.concepts.length; i++) {
    const mine = creatives.filter((c) => c.concept_index === i);
    if (!mine.some((c) => isHealthy(c, now))) out.push(i);
  }
  return out;
}

/** The most recently updated creative made from concept `index` (null when none). */
export function creativeForConcept<T extends CreativeState>(creatives: T[], index: number): T | null {
  let best: T | null = null;
  for (const c of creatives) {
    if (c.concept_index !== index) continue;
    if (!best || Date.parse(c.updated_at) > Date.parse(best.updated_at)) best = c;
  }
  return best;
}

/** True when one more creative costing `unit` still fits under the cap (spec §12.5 hard stop). */
export function nextBudgetCheck(spent: number, cap: number, unit: number): boolean {
  return spent + unit <= cap + 1e-9;
}

/** Concepts that do not (yet) have a ready creative. */
export function pendingCount(
  plan: { concepts: Concept[] },
  creatives: Pick<CreativeState, "concept_index" | "status">[],
): number {
  let n = 0;
  for (let i = 0; i < plan.concepts.length; i++) {
    if (!creatives.some((c) => c.concept_index === i && c.status === "ready")) n++;
  }
  return n;
}

/** An AI background is wanted when the template defaults to one or a prompt is set, and the plan allows it. */
export function needsBackground(
  templateKey: TemplateKey,
  inputs: { background_prompt?: string | null },
  plan: { ai_backgrounds: boolean } | null,
): boolean {
  const wanted = TEMPLATES[templateKey].defaultBackground || !!inputs.background_prompt?.trim();
  return wanted && (!plan || plan.ai_backgrounds);
}

export type ImageDecision = {
  templateKey: TemplateKey;
  inputs: { background_prompt?: string | null; background_asset_id?: string | null };
  plan: { ai_backgrounds: boolean } | null;
  /** Ids of the client's existing assets (renders included), to tell whether a background already exists. */
  assetIds: Set<string>;
};

/** `all` buys an image only when a background is wanted and none exists yet (same rule for budget and run). */
export function imageNeeded(d: ImageDecision): boolean {
  const have = !!d.inputs.background_asset_id && d.assetIds.has(d.inputs.background_asset_id);
  return needsBackground(d.templateKey, d.inputs, d.plan) && !have;
}

/** What one `all` run of this creative can cost: copy + (an image when needed and OpenAI is configured). */
export function creativeUnitFor(d: ImageDecision, openaiConfigured: boolean, imageUsd: number): number {
  return creativeUnitUsd({ background: openaiConfigured && imageNeeded(d) }, imageUsd);
}

export type VisualSeed =Pick<CreativeInputs, "colors" | "logo_asset_id" | "photo_asset_ids">;
type AssetLite = { id: string; kind: string; origin: string; tags: string[] };

/**
 * Visual inputs from the Brand Brain: colours (empty string = template fallback), the logo when it is a
 * listed asset, photos from the product's images else the client's first 1-3 non-render photos.
 */
export function seedVisuals(
  profile: BrandProfileData,
  products: ProductSnapshot[],
  productId: string | null,
  assets: AssetLite[],
): VisualSeed {
  const c = profile.visuals.colors;
  const ids = new Set(assets.filter((a) => a.origin !== "render").map((a) => a.id));
  const product = productId ? products.find((p) => p.id === productId) : undefined;
  const productPhotos = (product?.image_asset_ids ?? []).filter((id) => ids.has(id));
  const clientPhotos = assets
    .filter((a) => a.kind === "photo" && a.origin !== "render" && !a.tags.includes("background"))
    .slice(0, 3)
    .map((a) => a.id);
  const logo = profile.visuals.logo_asset_id;
  return {
    colors: {
      primary: c.primary?.value ?? "",
      accent: c.accent?.value ?? "",
      background: c.background?.value ?? "",
      text: c.text?.value ?? "",
    },
    logo_asset_id: logo && ids.has(logo) ? logo : null,
    photo_asset_ids: productPhotos.length ? productPhotos : clientPhotos,
  };
}

/** A full CreativeInputs from a partial one: provided values win, visuals from the seed, text empty. */
export function completeInputs(partial: Partial<CreativeInputs>, seed: VisualSeed): CreativeInputs {
  return {
    headline: partial.headline ?? "",
    subhead: partial.subhead ?? "",
    cta_text: partial.cta_text ?? "",
    cta_kind: partial.cta_kind ?? "website",
    ...(partial.body !== undefined ? { body: partial.body } : {}),
    ...(partial.slides !== undefined ? { slides: partial.slides } : {}),
    colors: partial.colors ?? seed.colors,
    logo_asset_id: partial.logo_asset_id !== undefined ? partial.logo_asset_id : seed.logo_asset_id,
    photo_asset_ids: partial.photo_asset_ids ?? seed.photo_asset_ids,
    background_asset_id: partial.background_asset_id ?? null,
    background_prompt: partial.background_prompt ?? null,
  };
}

type CreativeLite = {
  plan_id: string | null;
  concept_index: number | null;
  kind: CreativeKind;
  slot_date: string | null;
  platforms: Platform[];
  template_key: TemplateKey;
  product_id: string | null;
  title: string | null;
  brief: string | null;
};

/**
 * The concept the copy is written from: the plan's concept at the creative's index (with the creative's own
 * platforms / template / kind / product, which the operator may have changed), else one synthesised from the
 * single post's title + brief (CTA kind from the first Brand Brain CTA).
 */
export function conceptForCreative(
  creative: CreativeLite,
  plan: { concepts: Concept[] } | null,
  profile: BrandProfileData,
  today: string = new Date().toISOString().slice(0, 10),
): Concept {
  const own = {
    platforms: creative.platforms,
    template_key: creative.template_key,
    kind: creative.kind,
    product_id: creative.product_id,
  };
  const fromPlan = plan && creative.concept_index !== null ? plan.concepts[creative.concept_index] : undefined;
  if (fromPlan) return { ...fromPlan, ...own };
  return {
    slot_date: creative.slot_date ?? today,
    ...own,
    title: creative.title ?? "Post",
    angle: creative.brief ?? creative.title ?? "",
    claim_refs: [],
    cta_kind: profile.ctas[0]?.value.kind ?? "website",
    hashtags_seed: [],
  };
}

export type ReviewSource = { text: string; author: string };

/**
 * The review a review-template quote is verified against (Ruling 30): only a real `reviews[n]` entry with a
 * body AND an author counts - never a review-like claim ("Rated 4.9 stars"). The review containing the quote,
 * else the first usable review (so a non-matching quote fails), else null (no review in the Brand Brain).
 */
export function reviewSource(profile: BrandProfileData, quote: string): ReviewSource | null {
  const reviews = (profile.reviews ?? [])
    .map((r) => ({ text: (r.value?.body ?? "").trim(), author: (r.value?.author ?? "").trim() }))
    .filter((r) => r.text && r.author);
  const q = normalizeForMatch(quote);
  return reviews.find((r) => q.length > 0 && normalizeForMatch(r.text).includes(q)) ?? reviews[0] ?? null;
}

/**
 * Convert review concepts the brand cannot back: when no reviews[n] entry (body + author) exists, a `review` concept becomes
 * `product-hero` (when it has a product) else `tip-quote`, keeping date/platforms/title/angle. Returns the
 * list and how many were converted.
 */
export function guardReviewConcepts(
  concepts: Concept[],
  profile: BrandProfileData,
): { concepts: Concept[]; converted: number } {
  if (reviewSource(profile, "") !== null) return { concepts, converted: 0 };
  let converted = 0;
  const out = concepts.map((c) => {
    if (c.template_key !== "review") return c;
    converted++;
    return { ...c, template_key: (c.product_id ? "product-hero" : "tip-quote") as TemplateKey, kind: "image" as CreativeKind };
  });
  return { concepts: out, converted };
}
