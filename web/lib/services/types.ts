/**
 * types.ts — Shared types for the scraper service layer.
 *
 * Used by: services/google-places.ts, services/outscraper.ts, pipeline/stage-1-scrape.ts
 */

/** Mirror of the `website_kind` enum in db/schema.sql / migration 010. */
export type WebsiteKind =
  | "none"
  | "real"
  | "facebook"
  | "instagram"
  | "twitter"
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "yelp"
  | "yellowpages"
  | "foursquare"
  | "nextdoor"
  | "thumbtack"
  | "angi"
  | "bbb"
  | "linktree"
  | "beacons"
  | "about_me"
  | "carrd"
  | "sites_google"
  | "wix_free"
  | "weebly"
  | "webnode"
  | "blogspot"
  | "wordpress"
  | "other_social"
  | "other_aggregator"
  | "other_free_host";

export type BusinessStatus = "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";

export interface NormalizedLead {
  business_name: string;
  phone: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  has_website: boolean;
  website: string | null;
  /** Derived classification of `website` — drives the dashboard badge + qualifier signal. */
  website_kind: WebsiteKind;
  /** Google's businessStatus field. Null when scraper didn't fetch it. */
  business_status: BusinessStatus | null;
  /** True when the business has no fixed address (mobile / service-area only). */
  is_service_area_only: boolean;
  photos: Array<{ name?: string; url?: string; width?: number; height?: number }>;
  reviews: Array<{ text?: string; rating?: number; author?: string }>;
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  raw: unknown;
}
