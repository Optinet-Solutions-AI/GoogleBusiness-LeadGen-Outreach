/**
 * pricing.ts — Per-batch cost estimator, split into scrape vs build.
 *
 * Inputs:  scraper ('apify' | 'outscraper' | 'google_places' | 'warn' | 'sec' | 'exhibitors' | 'trustpilot' | 'tripadvisor'), limit
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

import { REVIEW_SITE_MAX_PER_QUERY, robotAsk } from "./review-sites";

/** Every batch source. The batch API and the cost preview both validate against this one list. */
export const SCRAPERS = ["apify", "google_places", "outscraper", "warn", "sec", "exhibitors", "trustpilot", "tripadvisor"] as const;
export type Scraper = (typeof SCRAPERS)[number];

// ─────────── Pricing constants (USD) ───────────
// Apify (default) — Google Maps + website-crawled emails & socials in one pass.
export const APIFY_PER_1K = 2.1;
export const APIFY_MAX_PER_QUERY = 300; // our safety cap; Apify has no hard per-query limit

export const OUTSCRAPER_PER_1K = 3.0;
export const OUTSCRAPER_MAX_PER_QUERY = 500;

// WARN closures — free public feed (WARN Feed, CC BY 4.0); no per-lead cost, no Gemini/Photos build cost.
export const WARN_MAX_PER_QUERY = 500;

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
/** Exhibitor batches: one OpenAI web-search call to find the shows, and ~2¢ per contact-finder lookup. */
export const EXHIBITOR_DISCOVERY_USD = 0.08;
export const EXHIBITOR_CONTACT_USD = 0.02;
export const EXHIBITORS_MAX_PER_QUERY = 500;
/** AI research (OpenAI web search contact finder) runs first on each qualified lead, up to the per-batch limit. */
// Review sites (Apify robots, prices read 19 Nov 2026): Trustpilot bills only rows with a contact; TripAdvisor bills
// per place plus a run start (Free/Bronze tier price; Silver+ is $0.00099).
export const TRUSTPILOT_USD_PER_LEAD = 0.00018;
export const TRIPADVISOR_USD_PER_PLACE = 0.00199;
export const TRIPADVISOR_RUN_USD = 0.005;
export const AI_RESEARCH_USD_PER_LEAD = 0.02;
/** Default of CONTACT_AI_MAX_PER_BATCH; the API passes the live setting. */
export const AI_RESEARCH_MAX_PER_BATCH = 100;
/** Number of business photos resolved through the Places Photos API per built site. */
export const BUILD_PHOTOS_PER_SITE = 6;
export const QUALIFY_RATE = 0.25;

// ─────────── Voice outreach (migration 016) ───────────
// The website audit (Playwright) and call-script generation (Gemini free tier)
// cost ~$0, so they're NOT added to the estimate. These placeholders exist so
// a paid voice provider (Vapi/Retell/Bland/Twilio) has a home when we go live.
// VOICE_CALL_PER_MIN is the rough per-minute carrier+LLM cost of an automated
// call; 0 today because the manual provider places no real calls.
export const WEBSITE_AUDIT_PER_LEAD = 0.0; // compute-only headless page load
export const CALL_SCRIPT_PER_LEAD = 0.0; // Gemini free tier
export const VOICE_CALL_PER_MIN = 0.0; // manual provider; set when a paid provider is wired in

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

/** Closing businesses (WARN / SEC): AI Lookup on each company in the notices since 23 Nov 2026. Adds the line. */
function closingAiLine(lines: CostLine[], eff: number, aiCap: number): number {
  const n = Math.min(eff, aiCap);
  if (n <= 0) return 0;
  const cost = n * AI_RESEARCH_USD_PER_LEAD;
  lines.push({ item: "AI Lookup: website, email, phone, a named contact (OpenAI web search)", qty: n, unit_usd: AI_RESEARCH_USD_PER_LEAD, cost_usd: round4(cost) });
  return cost;
}

export function estimate(scraper: Scraper, limit: number, opts: { aiCap?: number } = {}): Estimate {
  const aiCap = Math.max(0, opts.aiCap ?? AI_RESEARCH_MAX_PER_BATCH);
  const warnings: string[] = [];
  const scrapeLines: CostLine[] = [];
  let scraperCost = 0;
  let freeCreditConsumed = 0;
  let eff = limit;

  if (scraper === "apify") {
    const cap = APIFY_MAX_PER_QUERY;
    if (limit > cap) {
      warnings.push(`limit ${limit} exceeds our Apify safety cap (${cap}); raise it if you really need more`);
    }
    eff = Math.min(limit, cap);
    scraperCost = (eff / 1000) * APIFY_PER_1K;
    scrapeLines.push({
      item: "Apify Maps + emails/socials",
      qty: eff,
      unit_usd: APIFY_PER_1K / 1000,
      cost_usd: round4(scraperCost),
    });
  } else if (scraper === "outscraper") {
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
  } else if (scraper === "warn") {
    const cap = WARN_MAX_PER_QUERY;
    if (limit > cap) {
      warnings.push(`limit ${limit} exceeds the WARN per-query cap (${cap}); split into multiple batches`);
    }
    eff = Math.min(limit, cap);
    scrapeLines.push({ item: "WARN Feed (free)", qty: eff, unit_usd: 0, cost_usd: 0 });
    scraperCost = closingAiLine(scrapeLines, eff, aiCap);
  } else if (scraper === "sec") {
    eff = Math.min(limit, WARN_MAX_PER_QUERY);
    scrapeLines.push({ item: "SEC EDGAR filings (free)", qty: eff, unit_usd: 0, cost_usd: 0 });
    scraperCost = closingAiLine(scrapeLines, eff, aiCap);
  } else if (scraper === "exhibitors") {
    // Conference discovery (OpenAI web search, once per batch) + the contact finder for the exhibitors the free
    // site crawl leaves without an email (about half of them). Floor plans / exhibitor pages are free.
    eff = Math.min(limit, EXHIBITORS_MAX_PER_QUERY);
    scrapeLines.push({ item: "Conference discovery (OpenAI web search)", qty: 1, unit_usd: EXHIBITOR_DISCOVERY_USD, cost_usd: EXHIBITOR_DISCOVERY_USD });
    scrapeLines.push({ item: "Exhibitor lists / floor plans (free)", qty: eff, unit_usd: 0, cost_usd: 0 });
    const aiLookups = Math.min(eff, aiCap);
    if (aiLookups > 0) scrapeLines.push({ item: "AI Lookup: website, contacts, owner + Google check (OpenAI web search)", qty: aiLookups, unit_usd: EXHIBITOR_CONTACT_USD, cost_usd: round4(aiLookups * EXHIBITOR_CONTACT_USD) });
    scraperCost = EXHIBITOR_DISCOVERY_USD + aiLookups * EXHIBITOR_CONTACT_USD;
  } else if (scraper === "trustpilot" || scraper === "tripadvisor") {
    // Review sites: the robot is asked for 3x the limit (rating filter), then the contact finder runs on the kept
    // leads the robot left without an email, like exhibitors. Never built.
    const ask = robotAsk(limit);
    eff = Math.min(limit, REVIEW_SITE_MAX_PER_QUERY);
    if (scraper === "trustpilot") {
      scrapeLines.push({ item: "Trustpilot robot (businesses with a contact)", qty: ask, unit_usd: TRUSTPILOT_USD_PER_LEAD, cost_usd: round4(ask * TRUSTPILOT_USD_PER_LEAD) });
      scraperCost = ask * TRUSTPILOT_USD_PER_LEAD;
    } else {
      scrapeLines.push({ item: "TripAdvisor places (robot)", qty: ask, unit_usd: TRIPADVISOR_USD_PER_PLACE, cost_usd: round4(ask * TRIPADVISOR_USD_PER_PLACE) });
      scrapeLines.push({ item: "TripAdvisor run start", qty: 1, unit_usd: TRIPADVISOR_RUN_USD, cost_usd: TRIPADVISOR_RUN_USD });
      scraperCost = ask * TRIPADVISOR_USD_PER_PLACE + TRIPADVISOR_RUN_USD;
    }
    const aiLookups = Math.min(eff, aiCap);
    if (aiLookups > 0) scrapeLines.push({ item: "AI Lookup: website, contacts, owner + Google check (OpenAI web search)", qty: aiLookups, unit_usd: EXHIBITOR_CONTACT_USD, cost_usd: round4(aiLookups * EXHIBITOR_CONTACT_USD) });
    scraperCost += aiLookups * EXHIBITOR_CONTACT_USD;
  } else {
    throw new Error(`unknown scraper: ${scraper}`);
  }

  const qualifying = Math.max(1, Math.floor(eff * QUALIFY_RATE));

  // Google Maps leads: AI research runs first on each qualified lead (up to the per-batch limit).
  if (scraper === "apify" || scraper === "outscraper" || scraper === "google_places") {
    const aiLookups = Math.min(qualifying, aiCap);
    if (aiLookups > 0) {
      const aiCost = aiLookups * AI_RESEARCH_USD_PER_LEAD;
      scrapeLines.push({ item: "AI Lookup: website, contacts, owner + Google check (OpenAI web search)", qty: aiLookups, unit_usd: AI_RESEARCH_USD_PER_LEAD, cost_usd: round4(aiCost) });
      scraperCost += aiCost;
    }
  }

  const buildLines: CostLine[] = [];

  // WARN signal leads are never built (no site, no Gemini copy, no Photos) — $0 end to end.
  const buildable = scraper !== "warn" && scraper !== "sec" && scraper !== "exhibitors" && scraper !== "trustpilot" && scraper !== "tripadvisor";
  const geminiCost = buildable ? qualifying * CLAUDE_COPY_PER_SITE : 0;
  if (buildable) buildLines.push({
    item: "Gemini API (site copy, free tier)",
    qty: qualifying,
    unit_usd: CLAUDE_COPY_PER_SITE,
    cost_usd: round4(geminiCost),
  });

  const photoQty = qualifying * BUILD_PHOTOS_PER_SITE;
  const photoUnit = GOOGLE_PLACES_PHOTO_PER_1K / 1000;
  const photoCost = buildable ? photoQty * photoUnit : 0;
  if (buildable) buildLines.push({
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

/**
 * Spending cap for one review-site robot run (Apify maxTotalChargeUsd): 1.5x the robot's estimated cost for the rows
 * asked, never below $0.05, so a run can't overspend even if the robot misbehaves.
 */
export function robotCapUsd(scraper: "trustpilot" | "tripadvisor", limit: number): number {
  const ask = robotAsk(limit);
  const robot = scraper === "trustpilot" ? ask * TRUSTPILOT_USD_PER_LEAD : ask * TRIPADVISOR_USD_PER_PLACE + TRIPADVISOR_RUN_USD;
  return Math.max(0.05, round4(robot * 1.5));
}

export function compare(limit: number, opts: { aiCap?: number } = {}): Record<Scraper, Estimate> {
  return {
    apify: estimate("apify", limit, opts),
    outscraper: estimate("outscraper", limit, opts),
    google_places: estimate("google_places", limit, opts),
    warn: estimate("warn", limit, opts),
    sec: estimate("sec", limit, opts),
    exhibitors: estimate("exhibitors", limit, opts),
    trustpilot: estimate("trustpilot", limit, opts),
    tripadvisor: estimate("tripadvisor", limit, opts),
  };
}
