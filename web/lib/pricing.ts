/**
 * pricing.ts — Per-batch cost estimator, split into scrape vs build.
 *
 * Inputs:  scraper ('outscraper' | 'google_places'), limit
 * Outputs: Estimate { scrape: CostGroup, build: CostGroup, total_usd, ... }
 *          - scrape.subtotal_usd: stage-1 API cost (one Maps lookup)
 *          - build.subtotal_usd:  per-qualifying-lead Gemini copy + Photos API
 *          - total_usd: scrape + build (kept for the batches.estimated_cost_usd column)
 * Used by: app/api/pricing/*, app/api/batches/route.ts (preview chip),
 *          NewBatchModal (cost UI), orchestrator.createBatch
 *
 * NOTE: Verify these constants against current vendor pricing before relying
 * on the output for billing decisions. Last reviewed: 2026-05-03.
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

// Per-qualifying-lead build costs (apply equally regardless of scraper).
// CLAUDE_COPY_PER_SITE is named for legacy reasons — we currently use Gemini
// Flash (free tier covers the pilot). The number is a conservative paid-tier
// estimate so the displayed total isn't misleading once the free tier runs out.
export const CLAUDE_COPY_PER_SITE = 0.02;
/** Number of business photos resolved through the Places Photos API per built site. */
export const BUILD_PHOTOS_PER_SITE = 6;
export const QUALIFY_RATE = 0.25;

export interface CostLine {
  item: string;
  qty: number;
  unit_usd: number;
  cost_usd: number;
}

/** A logical group of related cost lines plus its subtotal. */
export interface CostGroup {
  subtotal_usd: number;
  lines: CostLine[];
}

export interface Estimate {
  scraper: Scraper;
  requested_limit: number;
  effective_limit: number;
  estimated_qualifying: number;
  /** Stage-1 lead-list scrape cost. Charged once per batch. */
  scrape: CostGroup;
  /**
   * Per-qualifying-lead site-build cost (Gemini copy + Photos API resolution).
   * Charged when the operator clicks Build/Deploy on a lead, NOT at batch
   * creation. Shown here so the operator can see the full lifecycle cost up
   * front.
   */
  build: CostGroup;
  /** scrape.subtotal_usd + build.subtotal_usd — what gets stored on the batch row. */
  total_usd: number;
  /** Flat list of every line across groups, kept for back-compat with older callers. */
  breakdown: CostLine[];
  warnings: string[];
  free_credit_consumed_usd: number;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function estimate(scraper: Scraper, limit: number): Estimate {
  const warnings: string[] = [];
  const scrapeLines: CostLine[] = [];
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
    scrapeLines.push({
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
    scrapeLines.push({
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

  const buildLines: CostLine[] = [];

  const geminiCost = qualifying * CLAUDE_COPY_PER_SITE;
  buildLines.push({
    item: "Gemini API (site copy, free tier)",
    qty: qualifying,
    unit_usd: CLAUDE_COPY_PER_SITE,
    cost_usd: round4(geminiCost),
  });

  const photoQty = qualifying * BUILD_PHOTOS_PER_SITE;
  const photoUnit = GOOGLE_PLACES_PHOTO_PER_1K / 1000;
  const photoCost = photoQty * photoUnit;
  buildLines.push({
    item: "Google Places Photos (per built site)",
    qty: photoQty,
    unit_usd: photoUnit,
    cost_usd: round4(photoCost),
  });
  if (scraper === "google_places") {
    freeCreditConsumed = round4(freeCreditConsumed + photoCost);
  }

  const scrapeSubtotal = round4(scraperCost);
  const buildSubtotal = round4(geminiCost + photoCost);
  const total = round4(scrapeSubtotal + buildSubtotal);

  if (scraper === "google_places" && total > GOOGLE_PLACES_FREE_CREDIT_PER_MONTH) {
    warnings.push(`estimated total $${total.toFixed(2)} exceeds Google's monthly $200 free credit`);
  }

  return {
    scraper,
    requested_limit: limit,
    effective_limit: eff,
    estimated_qualifying: qualifying,
    scrape: { subtotal_usd: scrapeSubtotal, lines: scrapeLines },
    build: { subtotal_usd: buildSubtotal, lines: buildLines },
    total_usd: total,
    breakdown: [...scrapeLines, ...buildLines],
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
