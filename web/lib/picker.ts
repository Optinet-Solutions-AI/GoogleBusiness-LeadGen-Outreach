/**
 * picker.ts — Pick the best variant for each section based on lead data.
 *
 * Inputs:  lead row + Gemini-generated SiteCopy
 * Outputs: { hero, services, reviews, trust, service_area, cta } variant slugs
 * Used by: lib/pipeline/stage-3-generate.ts → writes into data.json.variants
 *
 * Rules (premium-trades):
 *   hero          parallax-photos if ≥6 photos; else animated-gradient
 *   services      bento-grid (only variant for now)
 *   reviews       marquee if rating ≥4.5 AND review_count ≥50
 *                 hidden  if review_count <10
 *                 marquee otherwise (with fewer cards)
 *   trust         animated-strip if trust_strip has ≥3 entries; else hidden
 *   service_area  styled-list (only variant for now)
 *   cta           sticky-bar (only variant for now)
 *
 * Adding a variant: register it in templates/<slug>/src/lib/variants.ts
 * AND add a rule here so leads can pick it.
 */

export interface Variants {
  hero: "parallax-photos" | "animated-gradient";
  services: "bento-grid";
  reviews: "marquee" | "hidden";
  trust: "animated-strip" | "hidden";
  service_area: "styled-list";
  cta: "sticky-bar";
}

interface PickInput {
  rating?: number | null;
  review_count?: number | null;
  photos?: Array<unknown>;
  trust_strip?: string[];
}

export function pickVariants(lead: PickInput): Variants {
  const photoCount = lead.photos?.length ?? 0;
  const reviewCount = lead.review_count ?? 0;
  const rating = lead.rating ?? 0;
  const trustCount = lead.trust_strip?.length ?? 0;

  return {
    hero: photoCount >= 6 ? "parallax-photos" : "animated-gradient",
    services: "bento-grid",
    reviews:
      reviewCount < 10
        ? "hidden"
        : rating >= 4.5 && reviewCount >= 50
          ? "marquee"
          : "marquee",
    trust: trustCount >= 3 ? "animated-strip" : "hidden",
    service_area: "styled-list",
    cta: "sticky-bar",
  };
}
