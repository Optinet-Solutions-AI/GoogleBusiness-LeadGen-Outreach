/**
 * pricing.ts — Per-scraper cost estimator for batches.
 *
 * Inputs:  scraper ('outscraper' | 'google_places'), limit
 * Outputs: { scraper, total_usd, breakdown[], warnings[], effective_limit, ... }
 * Used by: app/api/pricing/*, app/api/batches/route.ts (for the preview chip
 *          in the dashboard's "Run batch" modal)
 *
 * NOTE: Verify these constants against current vendor pricing before relying
 * on the output for billing decisions. Last reviewed: 2026-04-28.
 */

export type Scraper = "outscraper" | "google_places";

// ─────────── Pricing constants (USD) ───────────
export const OUTSCRAPER_PER_1K = 3.0;
export const OUTSCRAPER_MAX_PER_QUERY = 500;

// Google Places API (New) — Pro SKU on Text Search (the field mask we use)
export const GOOGLE_PLACES_TEXT_SEARCH_PER_1K = 35.0;
export const GOOGLE_PLACES_PHOTO_PER_1K = 7.0;
export const GOOGLE_PLACES_FREE_CREDIT_PER_MONTH = 200.0;
export const GOOGLE_PLACES_MAX_PER_QUERY = 60;

// Downstream (apply equally regardless of scraper)
export const CLAUDE_COPY_PER_SITE = 0.02;
export const QUALIFY_RATE = 0.25;

export interface CostLine {
  item: string;
  qty: number;
  unit_usd: number;
  cost_usd: number;
}

export interface Estimate {
  scraper: Scraper;
  requested_limit: number;
  effective_limit: number;
  estimated_qualifying: number;
  total_usd: number;
  breakdown: CostLine[];
  warnings: string[];
  free_credit_consumed_usd: number;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function estimate(scraper: Scraper, limit: number): Estimate {
  const warnings: string[] = [];
  const breakdown: CostLine[] = [];
  let scraperCost = 0;
  let freeCreditConsumed = 0;
  let eff = limit;

  if (scraper === "outscraper") {
    const cap = OUTSCRAPER_MAX_PER_QUERY;
    if (limit > cap) {
      warnings.push(
        `limit ${limit} exceeds Outscraper per-query cap (${cap}); split into multiple batches`,
      );
    }
    eff = Math.min(limit, cap);
    scraperCost = (eff / 1000) * OUTSCRAPER_PER_1K;
    breakdown.push({
      item: "Outscraper Maps Search",
      qty: eff,
      unit_usd: OUTSCRAPER_PER_1K / 1000,
      cost_usd: round4(scraperCost),
    });
  } else if (scraper === "google_places") {
    const cap = GOOGLE_PLACES_MAX_PER_QUERY;
    if (limit > cap) {
      warnings.push(
        `limit ${limit} exceeds Google Places per-query cap (${cap}); we'll fetch ${cap} and stop. Split the query (e.g. by neighborhood) for more.`,
      );
    }
    eff = Math.min(limit, cap);
    scraperCost = (eff / 1000) * GOOGLE_PLACES_TEXT_SEARCH_PER_1K;
    breakdown.push({
      item: "Google Places Text Search (Pro)",
      qty: eff,
      unit_usd: GOOGLE_PLACES_TEXT_SEARCH_PER_1K / 1000,
      cost_usd: round4(scraperCost),
    });
    freeCreditConsumed = round4(scraperCost);
  } else {
    throw new Error(`unknown scraper: ${scraper}`);
  }

  const qualifying = Math.max(1, Math.floor(eff * QUALIFY_RATE));
  const claudeCost = qualifying * CLAUDE_COPY_PER_SITE;
  breakdown.push({
    item: "Gemini API (site copy, free tier)",
    qty: qualifying,
    unit_usd: CLAUDE_COPY_PER_SITE,
    cost_usd: round4(claudeCost),
  });

  const total = round4(scraperCost + claudeCost);

  if (scraper === "google_places" && total > GOOGLE_PLACES_FREE_CREDIT_PER_MONTH) {
    warnings.push(`estimated total $${total.toFixed(2)} exceeds Google's monthly $200 free credit`);
  }

  return {
    scraper,
    requested_limit: limit,
    effective_limit: eff,
    estimated_qualifying: qualifying,
    total_usd: total,
    breakdown,
    warnings,
    free_credit_consumed_usd: freeCreditConsumed,
  };
}

export function compare(limit: number): Record<Scraper, Estimate> {
  return {
    outscraper: estimate("outscraper", limit),
    google_places: estimate("google_places", limit),
  };
}
