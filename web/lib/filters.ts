/**
 * filters.ts — Lead qualification rules. Pure functions, no I/O.
 *
 * Inputs:  raw lead object from a scraper
 * Outputs: { passes: boolean, reason: string | null }
 * Used by: lib/pipeline/stage-1-scrape.ts before persisting a lead
 *
 * Rules (CLAUDE.md "Filter Logic"):
 *   - has_website must be false
 *   - rating >= 4.0
 *   - review_count >= 20
 *   - phone present
 *   - category contains the batch niche
 */

export const MIN_RATING = 4.0;
export const MIN_REVIEWS = 20;

export interface RawLead {
  has_website?: boolean;
  rating?: number | null;
  review_count?: number | null;
  phone?: string | null;
  category?: string | null;
  [key: string]: unknown;
}

export function qualifies(
  lead: RawLead,
  targetNiche?: string | null,
): { passes: boolean; reason: string | null } {
  if (lead.has_website) return { passes: false, reason: "has_website" };

  const rating = lead.rating ?? 0;
  if (rating < MIN_RATING) return { passes: false, reason: `rating<${MIN_RATING}` };

  const reviews = lead.review_count ?? 0;
  if (reviews < MIN_REVIEWS) return { passes: false, reason: `reviews<${MIN_REVIEWS}` };

  if (!lead.phone) return { passes: false, reason: "no_phone" };

  if (targetNiche) {
    const cat = (lead.category ?? "").toLowerCase();
    if (!cat.includes(targetNiche.toLowerCase())) {
      return { passes: false, reason: `category_mismatch:${cat}` };
    }
  }

  return { passes: true, reason: null };
}
