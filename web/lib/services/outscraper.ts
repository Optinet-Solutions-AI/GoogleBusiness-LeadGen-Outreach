/**
 * outscraper.ts — Outscraper Google Maps API client.
 *
 * Inputs:  query (e.g. 'plumber Austin TX'), limit, language, region
 * Outputs: NormalizedLead[]  — same shape as google-places.ts
 * Used by: lib/pipeline/stage-1-scrape.ts when batch.scraper == 'outscraper'
 *
 * Pricing: ~$1–3 per 1,000 leads. Batch requests; never loop one-at-a-time.
 * Docs: https://app.outscraper.com/api-docs
 */

import { env } from "../config";
import { hasRealWebsite } from "../filters";
import { getLogger } from "../logger";
import { retry } from "../retry";
import type { NormalizedLead } from "./types";

const log = getLogger("outscraper");
const BASE_URL = "https://api.app.outscraper.com";
export const MAX_PER_QUERY = 500;

interface OutscraperRaw {
  name?: string;
  phone?: string;
  full_address?: string;
  type?: string;
  category?: string;
  rating?: number;
  reviews?: number;
  site?: string;
  photos_sample?: Array<{ url?: string }>;
  reviews_data?: Array<{ review_text?: string; review_rating?: number; author_title?: string }>;
  place_id?: string;
  latitude?: number;
  longitude?: number;
}

export async function searchGoogleMaps(opts: {
  query: string;
  limit?: number;
  language?: string;
  region?: string;
}): Promise<NormalizedLead[]> {
  if (!env.OUTSCRAPER_API_KEY) throw new Error("OUTSCRAPER_API_KEY missing");
  const cap = Math.min(opts.limit ?? 100, MAX_PER_QUERY);
  const params = new URLSearchParams({
    query: opts.query,
    limit: String(cap),
    language: opts.language ?? "en",
    region: opts.region ?? "US",
    async: "false",
  });

  log.info({ query: opts.query, limit: cap }, "outscraper.request");
  const resp = await retry(
    () =>
      fetch(`${BASE_URL}/maps/search-v3?${params}`, {
        headers: { "X-API-KEY": env.OUTSCRAPER_API_KEY },
      }),
    { maxAttempts: 3 },
  );
  if (!resp.ok) throw new Error(`outscraper.error ${resp.status}: ${await resp.text()}`);
  const payload = (await resp.json()) as { data?: OutscraperRaw[][] };
  const rawResults = payload.data?.[0] ?? [];
  const leads = rawResults.map(normalize);
  log.info({ count: leads.length }, "outscraper.response");
  return leads;
}

function normalize(raw: OutscraperRaw): NormalizedLead {
  return {
    business_name: raw.name ?? "",
    phone: raw.phone ?? null,
    address: raw.full_address ?? null,
    category: raw.type ?? raw.category ?? null,
    rating: raw.rating ?? null,
    review_count: raw.reviews ?? null,
    has_website: hasRealWebsite(raw.site),
    website: raw.site ?? null,
    photos: (raw.photos_sample ?? []).map((p) => ({ url: p.url })),
    reviews: (raw.reviews_data ?? []).map((r) => ({
      text: r.review_text,
      rating: r.review_rating,
      author: r.author_title,
    })),
    place_id: raw.place_id ?? null,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    raw,
  };
}
