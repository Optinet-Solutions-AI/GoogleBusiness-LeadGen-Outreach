/**
 * stock-photos.ts — Curated Unsplash fallbacks for leads with sparse/poor photos.
 *
 * Inputs:  template_slug (e.g. 'premium-trades')
 * Outputs: array of high-quality Unsplash URLs
 * Used by: lib/pipeline/stage-3-generate.ts to pad lead.photos to ≥6 entries
 *
 * Rationale: Google Maps photos for local SMBs are wildly inconsistent — phone
 * snapshots of garages, badly cropped logos, fluorescent-lit interiors. The
 * single biggest visual win for cold-demo sites is replacing those with one
 * coherent set of magazine-quality shots. The prospect understands the demo
 * isn't their photos and we make that explicit in the cold email; the goal
 * is to show what their site COULD look like with proper photography.
 *
 * Each photo URL ends in `?w=1600&auto=format&fit=crop&q=80` so Unsplash
 * delivers AVIF/WebP at the requested width — friendly to PageSpeed.
 *
 * Adding more: only commit URLs you have personally verified resolve. Do not
 * invent photo IDs.
 */

const PARAMS = "?w=1600&auto=format&fit=crop&q=80";

const TRADES = [
  `https://images.unsplash.com/photo-1581094794329-c8112a89af12${PARAMS}`,
  `https://images.unsplash.com/photo-1503387762-592deb58ef4e${PARAMS}`,
  `https://images.unsplash.com/photo-1560185007-c5ca9d2c014d${PARAMS}`,
  `https://images.unsplash.com/photo-1562259949-e8e7689d7828${PARAMS}`,
  `https://images.unsplash.com/photo-1607472586893-edb57bdc0e39${PARAMS}`,
  `https://images.unsplash.com/photo-1585704032915-c3400ca199e7${PARAMS}`,
];

export const STOCK_PHOTOS_BY_TEMPLATE: Record<string, string[]> = {
  trades: TRADES,
  "premium-trades": TRADES,
  // Other templates fall through to TRADES via the helper below until we
  // curate niche-specific sets (food-beverage, beauty-wellness, ...).
};

/**
 * Returns up to `count` stock photos for a template_slug. If no curated set
 * exists for the slug, falls back to the trades set.
 */
export function pickStockPhotos(templateSlug: string, count: number): string[] {
  const list = STOCK_PHOTOS_BY_TEMPLATE[templateSlug] ?? STOCK_PHOTOS_BY_TEMPLATE.trades;
  return list.slice(0, count);
}
