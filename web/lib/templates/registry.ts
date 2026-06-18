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
