/**
 * variants.ts — Metadata registry of section variants this template ships with.
 *
 * The actual rendering happens in src/pages/index.astro (static imports + a
 * switch on data.variants[section]). This file is the canonical list, used
 * by the `template-component-hunter` skill to know what's already available
 * before suggesting new ones.
 *
 * To add a variant:
 *   1. Drop the .tsx into src/components/<section>/<variant>.tsx
 *   2. Register it here with `needs[]` (data fields the variant requires)
 *   3. Import + render it in the appropriate page
 *   4. Add a picker rule in web/lib/picker.ts so leads can pick it
 */

export interface VariantMeta {
  slug: string;
  needs: string[]; // data fields the variant requires (informational)
}

export const variants: Record<string, VariantMeta[]> = {
  hero: [
    { slug: "animated-gradient", needs: [] },
    { slug: "parallax-photos", needs: ["photos[6]"] },
  ],
  services: [{ slug: "bento-grid", needs: ["copy.services[1]"] }],
  reviews: [
    { slug: "marquee", needs: ["reviews[3]"] },
    { slug: "hidden", needs: [] },
  ],
  trust: [
    { slug: "animated-strip", needs: ["copy.trust_strip[3]"] },
    { slug: "hidden", needs: [] },
  ],
  service_area: [{ slug: "styled-list", needs: ["service_areas[1]"] }],
  cta: [{ slug: "sticky-bar", needs: ["phone"] }],
};
