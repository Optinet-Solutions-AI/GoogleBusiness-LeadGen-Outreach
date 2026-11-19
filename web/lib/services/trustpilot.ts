/**
 * trustpilot.ts — find low-rated businesses on Trustpilot through the Apify robot
 * scrapersdelight~trustpilot-business-leads-scraper (19 Nov 2026; verified with a paid test run).
 *
 * Inputs:  Trustpilot category id (e.g. "car_dealer"), 2-letter country, optional city, rating range, lead limit,
 *          spending cap, stop check
 * Outputs: { leads: NormalizedLead[] (signal.type "review_site"), usageUsd, found } — the robot filters the rating
 *          itself (minTrustScore / maxTrustScore / minReviews) and only bills rows with an email or phone
 * Used by: lib/pipeline/stage-1-scrape.ts (scraper "trustpilot"); workflows/run_review_site_batch.md
 */
import "@/lib/server-guard";
import { classifyWebsite } from "../filters";
import { getLogger } from "../logger";
import { inRatingRange, reviewPlaceId, robotAsk, type RatingRange } from "../review-sites";
import { runActor } from "./apify-run";
import type { NormalizedLead } from "./types";

const log = getLogger("trustpilot");
export const TRUSTPILOT_ACTOR = "scrapersdelight~trustpilot-business-leads-scraper";

type Item = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One robot row → a review-site lead; null for error rows or rows without a name / profile link. Pure. */
export function mapTrustpilotItem(item: Item): NormalizedLead | null {
  const name = str(item.name);
  const profileUrl = str(item.profileUrl);
  if (!name || !profileUrl) return null;
  const website = str(item.website);
  const rating = num(item.trustScore);
  const reviews = num(item.reviewCount);
  const categories = Array.isArray(item.categories)
    ? (item.categories as Item[]).map((c) => str(c?.name)).filter((c): c is string => Boolean(c))
    : [];
  const address = [str(item.address), str(item.city), str(item.postalCode), str(item.countryName)].filter(Boolean).join(", ") || null;
  return {
    business_name: name,
    phone: str(item.phone),
    address,
    category: str(item.primaryCategory) ?? categories[0] ?? null,
    rating,
    review_count: reviews,
    has_website: Boolean(website),
    website,
    website_kind: classifyWebsite(website),
    email: str(item.email),
    business_status: item.isClosed === true ? "CLOSED_PERMANENTLY" : null,
    is_service_area_only: false,
    photos: [],
    reviews: [],
    place_id: reviewPlaceId("trustpilot", profileUrl),
    latitude: null,
    longitude: null,
    country_code: str(item.countryCode),
    signal: {
      type: "review_site",
      date: null,
      source_url: profileUrl,
      meta: { platform: "trustpilot", rating, review_count: reviews, profile_url: profileUrl, categories },
    },
    raw: item,
  };
}

export async function searchTrustpilot(opts: {
  category: string;
  country: string;
  city?: string | null;
  settings: RatingRange;
  limit: number;
  maxChargeUsd: number;
  shouldStop?: () => boolean;
}): Promise<{ leads: NormalizedLead[]; usageUsd: number | null; found: number }> {
  const { items, usageUsd } = await runActor<Item>({
    actor: TRUSTPILOT_ACTOR,
    input: {
      categories: [opts.category],
      countries: [opts.country.toUpperCase()],
      ...(opts.city?.trim() ? { location: opts.city.trim() } : {}),
      minTrustScore: opts.settings.min_rating,
      maxTrustScore: opts.settings.max_rating,
      minReviews: opts.settings.min_reviews,
      maxResults: robotAsk(opts.limit),
      onlyWithContact: true,
      recentReviews: 0,
    },
    maxChargeUsd: opts.maxChargeUsd,
    shouldStop: opts.shouldStop,
  });
  const mapped = items.map(mapTrustpilotItem).filter((l): l is NormalizedLead => l !== null);
  if (items.length > 0 && mapped.length === 0) {
    const why = items.map((i) => str(i.error)).find(Boolean) ?? "the robot returned no usable businesses";
    throw new Error(`Trustpilot search failed: ${why}`);
  }
  const leads = mapped.filter((l) => inRatingRange(l.rating, l.review_count, opts.settings)).slice(0, opts.limit);
  log.info({ found: items.length, kept: leads.length, usage_usd: usageUsd }, "trustpilot.search.done");
  return { leads, usageUsd, found: items.length };
}
