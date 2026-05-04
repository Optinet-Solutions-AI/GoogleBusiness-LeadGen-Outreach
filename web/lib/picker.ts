/**
 * picker.ts — Deterministic fallback variant picker.
 *
 * Inputs:  lead row + optional niche key + Gemini-generated SiteCopy
 * Outputs: { hero, services, reviews, trust, service_area, cta } variant slugs
 * Used by: lib/pipeline/stage-3-generate.ts when Gemini's variants are
 *          missing/malformed.
 *
 * Niche-aware rules. Gemini is the primary art director; this function
 * exists as a defensive fallback so a build never lands on a schema-empty
 * variants object. Keep these rules conservative — they should produce a
 * "good but not surprising" choice.
 *
 * Adding a variant: also expand templates/<slug>/src/lib/data.ts Variants
 * type AND lib/services/gemini.ts (AiVariants + RESPONSE_SCHEMA enum).
 */
import { classifyNiche, type NicheKey } from "./niche";

/**
 * Page-level theme dimensions (background overlay, button style, font pair)
 * — kept in sync with templates/premium-trades/src/lib/data.ts Theme type
 * AND web/lib/services/gemini.ts AiTheme.
 */
export interface Theme {
  background: "plain" | "aurora-blobs" | "animated-gradient-mesh";
  button_style: "solid" | "shimmer" | "shining-sweep";
  font_pair: "editorial-serif" | "modern-sans" | "classical-serif";
}

/**
 * Niche-keyed default theme used when Gemini doesn't return a theme block.
 * Each combo is hand-tuned per niche to land the right vibe out of the box.
 */
export function pickTheme(niche: NicheKey): Theme {
  switch (niche) {
    case "professional-services":
      // Legal/financial bar is restraint — keep "plain" but the new
      // global.css plain-bg adds a subtle palette-tinted wash so it's
      // never bare white anymore.
      return { background: "plain", button_style: "shimmer", font_pair: "classical-serif" };
    case "real-estate":
      return { background: "animated-gradient-mesh", button_style: "shimmer", font_pair: "classical-serif" };
    case "beauty-wellness":
      return { background: "aurora-blobs", button_style: "solid", font_pair: "editorial-serif" };
    case "home-goods-vintage":
      return { background: "aurora-blobs", button_style: "solid", font_pair: "editorial-serif" };
    case "food-beverage":
      return { background: "aurora-blobs", button_style: "shining-sweep", font_pair: "editorial-serif" };
    case "fitness-pet":
      return { background: "animated-gradient-mesh", button_style: "shining-sweep", font_pair: "modern-sans" };
    case "home-services":
    case "landscaping-construction":
    default:
      return { background: "aurora-blobs", button_style: "shining-sweep", font_pair: "modern-sans" };
  }
}

export interface Variants {
  hero:
    | "parallax-photos"
    | "animated-gradient"
    | "full-bleed-photo"
    | "split-with-stats"
    | "premium-hero";
  services: "bento-grid" | "photo-cards" | "minimal-list";
  reviews: "marquee" | "masonry-grid" | "single-featured" | "hidden";
  trust: "animated-strip" | "badge-grid" | "hidden";
  service_area: "styled-list";
  cta: "sticky-bar" | "full-section";
}

interface PickInput {
  rating?: number | null;
  review_count?: number | null;
  photos?: Array<unknown>;
  trust_strip?: string[];
  category?: string | null;
  niche?: NicheKey;
}

const PROFESSIONAL: NicheKey[] = ["professional-services"];
const PHOTOGENIC: NicheKey[] = [
  "beauty-wellness",
  "home-goods-vintage",
  "food-beverage",
  "real-estate",
];
const HIGH_INTENT: NicheKey[] = [
  "home-services",
  "landscaping-construction",
];

export function pickVariants(lead: PickInput): Variants {
  const niche = lead.niche ?? classifyNiche(lead.category ?? null);
  const photoCount = lead.photos?.length ?? 0;
  const reviewCount = lead.review_count ?? 0;
  const rating = lead.rating ?? 0;
  const trustCount = lead.trust_strip?.length ?? 0;

  // ── HERO ────────────────────────────────────────────────────────────────
  let hero: Variants["hero"];
  if (PROFESSIONAL.includes(niche) && reviewCount >= 50) {
    // High-trust professional services with proof: animated blob mesh +
    // word-by-word title reveal reads as an award-winning agency site.
    hero = "premium-hero";
  } else if (PROFESSIONAL.includes(niche)) {
    hero = "animated-gradient";  // photos feel stocky for lawyers/accountants
  } else if (PHOTOGENIC.includes(niche) && photoCount >= 1) {
    hero = "full-bleed-photo";  // cinematic single image
  } else if (rating >= 4.5 && reviewCount >= 50 && photoCount >= 1) {
    hero = "split-with-stats";  // lead with social proof
  } else if (photoCount >= 6) {
    hero = "parallax-photos";
  } else {
    hero = "animated-gradient";
  }

  // ── SERVICES ────────────────────────────────────────────────────────────
  let services: Variants["services"];
  if (PROFESSIONAL.includes(niche)) services = "minimal-list";
  else if (PHOTOGENIC.includes(niche)) services = "photo-cards";
  else services = "bento-grid";

  // ── REVIEWS ─────────────────────────────────────────────────────────────
  let reviews: Variants["reviews"];
  if (reviewCount < 3) reviews = "hidden";
  else if (reviewCount >= 50) reviews = "masonry-grid";  // wall of proof
  else if (reviewCount < 10) reviews = "single-featured"; // lean on quality
  else reviews = "marquee";

  // ── TRUST ───────────────────────────────────────────────────────────────
  let trust: Variants["trust"];
  if (trustCount < 3) trust = "hidden";
  else if (PROFESSIONAL.includes(niche) || HIGH_INTENT.includes(niche)) trust = "badge-grid";
  else trust = "animated-strip";

  // ── CTA ─────────────────────────────────────────────────────────────────
  // sticky-bar always renders globally; this picks the in-page CTA section.
  const cta: Variants["cta"] = HIGH_INTENT.includes(niche) ? "full-section" : "sticky-bar";

  return {
    hero,
    services,
    reviews,
    trust,
    service_area: "styled-list",
    cta,
  };
}
