/**
 * types.ts — Shared types for the scraper service layer.
 *
 * Used by: services/google-places.ts, services/outscraper.ts, pipeline/stage-1-scrape.ts
 */

export interface NormalizedLead {
  business_name: string;
  phone: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  has_website: boolean;
  website: string | null;
  photos: Array<{ name?: string; url?: string; width?: number; height?: number }>;
  reviews: Array<{ text?: string; rating?: number; author?: string }>;
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  raw: unknown;
}
