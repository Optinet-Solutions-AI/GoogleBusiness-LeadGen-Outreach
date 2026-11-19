/**
 * tripadvisor.ts — find low-rated places on TripAdvisor through the Apify robot clearpath~tripadvisor-scraper
 * (19 Nov 2026; verified with a paid test run).
 *
 * Inputs:  city (sent as the name only), place type (restaurants / hotels / attractions), rating range, lead limit,
 *          spending cap, stop check
 * Outputs: { leads: NormalizedLead[] (signal.type "review_site"), usageUsd, found } — the robot has no rating
 *          filter, so it is asked for 3x the limit and we keep the places inside the range
 * Used by: lib/pipeline/stage-1-scrape.ts (scraper "tripadvisor"); workflows/run_review_site_batch.md
 */
import "@/lib/server-guard";
import { classifyWebsite } from "../filters";
import { getLogger } from "../logger";
import { cityForTripAdvisor, inRatingRange, reviewPlaceId, robotAsk, type RatingRange } from "../review-sites";
import { runActor } from "./apify-run";
import type { NormalizedLead } from "./types";

const log = getLogger("tripadvisor");
export const TRIPADVISOR_ACTOR = "clearpath~tripadvisor-scraper";
export const TRIPADVISOR_TYPES = ["restaurants", "hotels", "attractions"] as const;
export type TripAdvisorType = (typeof TRIPADVISOR_TYPES)[number];

type Item = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One robot row → a review-site lead; null for error rows or rows without a name / profile link. Pure. */
export function mapTripAdvisorItem(item: Item): NormalizedLead | null {
  if (item.type !== undefined && item.type !== "place") return null;
  const name = str(item.name);
  const profileUrl = str(item.url);
  if (!name || !profileUrl) return null;
  const website = str(item.website);
  const rating = num(item.rating);
  const reviews = num(item.reviewsCount);
  const category = str(item.category);
  return {
    business_name: name,
    phone: str(item.phone),
    address: str(item.address),
    category,
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
    place_id: reviewPlaceId("tripadvisor", profileUrl),
    latitude: num(item.latitude),
    longitude: num(item.longitude),
    country_code: null,
    signal: {
      type: "review_site",
      date: null,
      source_url: profileUrl,
      meta: { platform: "tripadvisor", rating, review_count: reviews, profile_url: profileUrl, categories: category ? [category] : [] },
    },
    raw: item,
  };
}

export async function searchTripAdvisor(opts: {
  city: string;
  category: TripAdvisorType;
  settings: RatingRange;
  limit: number;
  maxChargeUsd: number;
  shouldStop?: () => boolean;
}): Promise<{ leads: NormalizedLead[]; usageUsd: number | null; found: number }> {
  const { items, usageUsd } = await runActor<Item>({
    actor: TRIPADVISOR_ACTOR,
    input: {
      locations: [cityForTripAdvisor(opts.city)],
      categories: [opts.category],
      maxPlacesPerCategory: robotAsk(opts.limit),
      includeDetails: true,
    },
    maxChargeUsd: opts.maxChargeUsd,
    shouldStop: opts.shouldStop,
  });
  const mapped = items.map(mapTripAdvisorItem).filter((l): l is NormalizedLead => l !== null);
  if (items.length > 0 && mapped.length === 0) {
    const why = items.map((i) => str(i.error)).find(Boolean) ?? "the robot returned no usable places";
    throw new Error(`TripAdvisor search failed: ${why}`);
  }
  const leads = mapped.filter((l) => inRatingRange(l.rating, l.review_count, opts.settings)).slice(0, opts.limit);
  log.info({ found: items.length, kept: leads.length, usage_usd: usageUsd }, "tripadvisor.search.done");
  return { leads, usageUsd, found: items.length };
}
