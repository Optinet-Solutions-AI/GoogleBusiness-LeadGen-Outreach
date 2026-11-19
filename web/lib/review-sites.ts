/**
 * review-sites.ts — shared, pure rules for the review-site sources (Trustpilot, TripAdvisor; 19 Nov 2026).
 *
 * Inputs:  plain values (limits, ratings, profile URLs, city text)
 * Outputs: how many rows to ask a robot for, rating-range checks, lead ids, labels
 * Used by: lib/pricing.ts, lib/services/trustpilot.ts, lib/services/tripadvisor.ts, lib/pipeline/stage-1-scrape.ts
 */

export type ReviewPlatform = "trustpilot" | "tripadvisor";

export const PLATFORM_LABEL: Record<ReviewPlatform, string> = { trustpilot: "Trustpilot", tripadvisor: "TripAdvisor" };

export interface RatingRange {
  min_rating: number;
  max_rating: number;
  min_reviews: number;
}

/** The lead's place_id: platform + the profile URL's path (no host, query or hash), so a re-found profile matches. */
export function reviewPlaceId(platform: ReviewPlatform, profileUrl: string): string {
  let path = profileUrl;
  try {
    path = new URL(profileUrl).pathname;
  } catch {
    path = profileUrl.split(/[?#]/)[0];
  }
  return `${platform}:${path}`;
}

/** Inside the operator's rating range (inclusive) with enough reviews; an unknown rating or count is out. */
export function inRatingRange(rating: number | null, reviews: number | null, r: RatingRange): boolean {
  if (typeof rating !== "number" || typeof reviews !== "number" || rating <= 0) return false;
  return rating >= r.min_rating && rating <= r.max_rating && reviews >= r.min_reviews;
}

/** TripAdvisor's robot wants the city name only: "Austin, TX" resolved to a single attraction in the test run. */
export function cityForTripAdvisor(city: string): string {
  return city.split(",")[0].trim();
}

/** Most rows one review-site robot run may return (our safety cap, like Apify Google Maps). */
export const REVIEW_SITE_MAX_PER_QUERY = 300;

/** Ask the robot for 3× the leads wanted: some rows fall outside the rating range or have too few reviews. */
export function robotAsk(limit: number): number {
  return Math.min(Math.max(1, limit) * 3, REVIEW_SITE_MAX_PER_QUERY);
}
