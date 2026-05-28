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
    // Professional / legal / financial — restraint.
    case "professional-legal-financial":
    case "real-estate":
      return { background: "plain", button_style: "shimmer", font_pair: "classical-serif" };

    // Creative / tech — modern + animated.
    case "professional-creative-tech":
      return { background: "animated-gradient-mesh", button_style: "shimmer", font_pair: "modern-sans" };

    // Beauty / spa / event styling — editorial / luxe.
    case "beauty-hair-nails":
    case "spa-massage-wellness":
    case "event-services":
    case "boutique-gift-retail":
      return { background: "aurora-blobs", button_style: "solid", font_pair: "editorial-serif" };

    // Vintage / home decor — editorial-warm.
    case "vintage-antiques-thrift":
    case "home-decor-retail":
      return { background: "aurora-blobs", button_style: "solid", font_pair: "editorial-serif" };

    // Food — appetite warmth.
    case "food-restaurants":
    case "food-cafe-bakery":
    case "food-catering-events":
      return { background: "aurora-blobs", button_style: "shining-sweep", font_pair: "editorial-serif" };

    // Fitness / pets — kinetic.
    case "fitness-gyms":
    case "pet-services":
      return { background: "animated-gradient-mesh", button_style: "shining-sweep", font_pair: "modern-sans" };

    // Automotive — hard surfaces.
    case "automotive":
      return { background: "animated-gradient-mesh", button_style: "solid", font_pair: "modern-sans" };

    // All trades fallback.
    case "home-services-trades":
    case "cleaning-restoration":
    case "roofing-exterior":
    case "landscaping-outdoor":
    case "construction-remodel":
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
    | "premium-hero"
    | "editorial-split";
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
  /** Variants used by recent same-niche leads. When the deterministic
   *  choice for a slot is already in the avoid set, swap to the
   *  configured alternative for that slot. Niche-fit still wins —
   *  these are "prefer not to repeat" hints, not hard exclusions. */
  avoid?: {
    hero?: string[];
    services?: string[];
    reviews?: string[];
    trust?: string[];
    service_area?: string[];
    cta?: string[];
  };
}

/**
 * For each slot, the ordered fallback chain when the primary pick is in
 * the avoid set. We walk the chain in order, picking the first option
 * that ISN'T in avoid. If all options are exhausted, fall back to the
 * primary anyway (niche-fit > diversity).
 */
const HERO_FALLBACKS: Record<Variants["hero"], Variants["hero"][]> = {
  "premium-hero":       ["editorial-split", "split-with-stats", "animated-gradient", "full-bleed-photo", "parallax-photos"],
  "animated-gradient":  ["premium-hero", "editorial-split", "split-with-stats", "full-bleed-photo", "parallax-photos"],
  "editorial-split":    ["full-bleed-photo", "parallax-photos", "split-with-stats", "premium-hero", "animated-gradient"],
  "full-bleed-photo":   ["editorial-split", "parallax-photos", "split-with-stats", "animated-gradient", "premium-hero"],
  "split-with-stats":   ["editorial-split", "full-bleed-photo", "parallax-photos", "premium-hero", "animated-gradient"],
  "parallax-photos":    ["editorial-split", "full-bleed-photo", "split-with-stats", "animated-gradient", "premium-hero"],
};
const SERVICES_FALLBACKS: Record<Variants["services"], Variants["services"][]> = {
  "minimal-list": ["bento-grid", "photo-cards"],
  "photo-cards":  ["bento-grid", "minimal-list"],
  "bento-grid":   ["photo-cards", "minimal-list"],
};
const REVIEWS_FALLBACKS: Record<Exclude<Variants["reviews"], "hidden">, Exclude<Variants["reviews"], "hidden">[]> = {
  "marquee":          ["masonry-grid", "single-featured"],
  "masonry-grid":     ["marquee", "single-featured"],
  "single-featured":  ["masonry-grid", "marquee"],
};
const TRUST_FALLBACKS: Record<Exclude<Variants["trust"], "hidden">, Exclude<Variants["trust"], "hidden">[]> = {
  "animated-strip": ["badge-grid"],
  "badge-grid":     ["animated-strip"],
};
const CTA_FALLBACKS: Record<Variants["cta"], Variants["cta"][]> = {
  "sticky-bar":   ["full-section"],
  "full-section": ["sticky-bar"],
};

/** Walk the fallback chain to find the first option not in `avoid`. */
function diversifyPick<T extends string>(
  primary: T,
  fallbacks: T[],
  avoid: string[] | undefined,
): T {
  if (!avoid || avoid.length === 0 || !avoid.includes(primary)) return primary;
  for (const alt of fallbacks) {
    if (!avoid.includes(alt)) return alt;
  }
  return primary;
}

const PROFESSIONAL: NicheKey[] = [
  "professional-legal-financial",
  "professional-creative-tech",
];
const PHOTOGENIC: NicheKey[] = [
  "beauty-hair-nails",
  "spa-massage-wellness",
  "food-restaurants",
  "food-cafe-bakery",
  "food-catering-events",
  "real-estate",
  "vintage-antiques-thrift",
  "home-decor-retail",
  "event-services",
  "boutique-gift-retail",
];
const HIGH_INTENT: NicheKey[] = [
  "home-services-trades",
  "cleaning-restoration",
  "roofing-exterior",
  "landscaping-outdoor",
  "construction-remodel",
  "automotive",
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
  } else if (PHOTOGENIC.includes(niche) && photoCount >= 1 && rating >= 4.5 && reviewCount >= 25) {
    // Photogenic niches with strong proof: editorial-split's typography-led
    // calm + brand-tinted photo reads as a magazine feature, not a SaaS hero.
    hero = "editorial-split";
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

  // ── Photo-count clamp ───────────────────────────────────────────────────
  hero = clampHeroToPhotos(hero, photoCount);

  // ── Diversity bias against recent same-niche picks ──────────────────────
  // When the deterministic choice matches a variant a recent neighbor
  // lead already shipped, walk that slot's fallback chain to find the
  // first equally-fit option. Niche/photo/review constraints still won
  // above — we never produce a structurally-wrong variant just to avoid
  // a repeat.
  const avoid = lead.avoid ?? {};
  hero = diversifyPick(hero, HERO_FALLBACKS[hero], avoid.hero);
  // After diversity, re-clamp in case the swap landed on a hero that
  // needs more photos than we have.
  hero = clampHeroToPhotos(hero, photoCount);
  services = diversifyPick(services, SERVICES_FALLBACKS[services], avoid.services);
  if (reviews !== "hidden") {
    reviews = diversifyPick(
      reviews,
      REVIEWS_FALLBACKS[reviews as Exclude<Variants["reviews"], "hidden">],
      avoid.reviews,
    );
  }
  if (trust !== "hidden") {
    trust = diversifyPick(
      trust,
      TRUST_FALLBACKS[trust as Exclude<Variants["trust"], "hidden">],
      avoid.trust,
    );
  }
  const ctaFinal = diversifyPick(cta, CTA_FALLBACKS[cta], avoid.cta);

  return {
    hero,
    services,
    reviews,
    trust,
    service_area: "styled-list",
    cta: ctaFinal,
  };
}

/**
 * Force a hero variant choice to be compatible with the actual photo count.
 * Used by stage-3-generate.ts AFTER pickVariants OR Gemini-supplied variants
 * have been chosen, so the template never tries to render parallax-photos
 * for a lead with 0 photos.
 */
export function clampHeroToPhotos(
  hero: Variants["hero"],
  photoCount: number,
): Variants["hero"] {
  const photosThatNeedImages: Variants["hero"][] = [
    "parallax-photos",
    "full-bleed-photo",
    "split-with-stats",
    "editorial-split",
  ];
  if (photoCount === 0 && photosThatNeedImages.includes(hero)) return "animated-gradient";
  if (photoCount < 3 && hero === "parallax-photos") return "full-bleed-photo";
  return hero;
}
