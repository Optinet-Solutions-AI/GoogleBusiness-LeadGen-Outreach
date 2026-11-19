/**
 * review-sites.ts — shared, pure rules for the review-site sources (Trustpilot, TripAdvisor; 19 Nov 2026).
 *
 * Inputs:  plain values (limits, ratings, profile URLs, city text)
 * Outputs: how many rows to ask a robot for, rating-range checks, lead ids, labels
 * Used by: lib/pricing.ts, lib/services/trustpilot.ts, lib/services/tripadvisor.ts, lib/pipeline/stage-1-scrape.ts
 */

/** Most rows one review-site robot run may return (our safety cap, like Apify Google Maps). */
export const REVIEW_SITE_MAX_PER_QUERY = 300;

/** Ask the robot for 3× the leads wanted: some rows fall outside the rating range or have too few reviews. */
export function robotAsk(limit: number): number {
  return Math.min(Math.max(1, limit) * 3, REVIEW_SITE_MAX_PER_QUERY);
}
