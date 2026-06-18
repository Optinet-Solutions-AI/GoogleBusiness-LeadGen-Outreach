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
