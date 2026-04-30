/**
 * google-places.ts — Google Places API (New) client. Official Maps Platform path.
 *
 * Inputs:  query (e.g. 'plumber in Austin, TX'), limit, language, region
 * Outputs: NormalizedLead[]  — same shape as outscraper.ts
 * Used by: lib/pipeline/stage-1-scrape.ts when batch.scraper == 'google_places'
 *
 * Pricing (verify at https://mapsplatform.google.com/pricing/ before billing):
 *   - Text Search (Pro SKU, with website + phone + address): ~$35/1k requests
 *   - Photos (separate, $7/1k) — we skip by default to preserve free credit
 *   - $200/mo free credit
 *
 * Hard cap: Places API New returns max 60 results per query (3 pages of 20).
 * For larger batches, vary the query or use Outscraper.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */

import { env } from "../config";
import { hasRealWebsite } from "../filters";
import { getLogger } from "../logger";
import { retry } from "../retry";
import type { NormalizedLead } from "./types";

const log = getLogger("google-places");
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const PER_PAGE = 20;
export const MAX_PER_QUERY = 60;
// Belt-and-suspenders cap on pagination loops. Places API New advertises a
// 60-result max (3 pages × 20), but we've observed it return non-empty
// nextPageToken indefinitely for low-result queries (e.g. small-city niches
// with <20 listings). Without this cap a runaway scrape can burn $3+ of
// Places quota chasing the same 8 results across 90+ paginated requests.
const MAX_PAGES = 5;

// Field mask drives the SKU we get billed at. This = "Pro" tier.
// Adding `places.reviews` or `places.regularOpeningHours` escalates to Enterprise.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.location",
  "places.photos",
  "nextPageToken",
].join(",");

interface PlacesResponse {
  places?: PlaceRaw[];
  nextPageToken?: string;
}

interface PlaceRaw {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  location?: { latitude?: number; longitude?: number };
  photos?: Array<{ name?: string; widthPx?: number; heightPx?: number }>;
}

function headers(): Record<string, string> {
  if (!env.GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY missing");
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
    "X-Goog-FieldMask": FIELD_MASK,
  };
}

export async function searchText(opts: {
  query: string;
  limit?: number;
  language?: string;
  region?: string;
}): Promise<NormalizedLead[]> {
  const { query } = opts;
  const cap = Math.min(opts.limit ?? MAX_PER_QUERY, MAX_PER_QUERY);
  if ((opts.limit ?? 0) > MAX_PER_QUERY) {
    log.warn({ requested: opts.limit, cappedTo: cap }, "places.limit_capped");
  }
  const language = opts.language ?? env.GOOGLE_PLACES_DEFAULT_LANGUAGE;
  const region = (opts.region ?? env.GOOGLE_PLACES_DEFAULT_REGION).toLowerCase();

  const all: PlaceRaw[] = [];
  let pageToken: string | undefined;
  let pageIndex = 0;
  while (all.length < cap && pageIndex < MAX_PAGES) {
    // Places API New requires a ~1.5s delay before pageToken becomes valid.
    // Without it, the second/third page request returns INVALID_REQUEST and
    // our retry decorator burns 10–30s of serverless time per page.
    if (pageToken) await new Promise((r) => setTimeout(r, 1800));

    const body: Record<string, unknown> = {
      textQuery: query,
      languageCode: language,
      regionCode: region,
      pageSize: Math.min(PER_PAGE, cap - all.length),
    };
    if (pageToken) body.pageToken = pageToken;

    log.info({ query, page: pageIndex, sofar: all.length }, "places.request");
    const resp = await retry(
      () =>
        fetch(ENDPOINT, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        }),
      { maxAttempts: 3 },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`places.error ${resp.status}: ${text}`);
    }
    const json = (await resp.json()) as PlacesResponse;
    const newPlaces = json.places ?? [];
    all.push(...newPlaces);
    pageToken = json.nextPageToken;
    pageIndex += 1;
    // Stop if Places returned an empty page — for low-result queries
    // (small city + niche combo with <20 real listings) the API will keep
    // handing us nextPageToken even though there's nothing left to return.
    if (!newPlaces.length) break;
    if (!pageToken) break;
  }

  const leads = all.slice(0, cap).map(normalize);
  log.info({ count: leads.length, query }, "places.response");
  return leads;
}

function normalize(raw: PlaceRaw): NormalizedLead {
  const types = raw.types ?? [];
  return {
    business_name: raw.displayName?.text ?? "",
    phone: raw.nationalPhoneNumber ?? raw.internationalPhoneNumber ?? null,
    address: raw.formattedAddress ?? null,
    category: types[0] ?? null,
    rating: raw.rating ?? null,
    review_count: raw.userRatingCount ?? null,
    // True only if Google's websiteUri points at a real owned site, not a
    // Facebook/Yelp/Linktree/etc. profile — see lib/filters.ts.
    has_website: hasRealWebsite(raw.websiteUri),
    website: raw.websiteUri ?? null,
    photos: (raw.photos ?? []).map((p) => ({
      name: p.name ?? "",
      width: p.widthPx,
      height: p.heightPx,
    })),
    reviews: [], // Pro tier doesn't include reviews; opt into Enterprise to fetch them
    place_id: raw.id ?? null,
    latitude: raw.location?.latitude ?? null,
    longitude: raw.location?.longitude ?? null,
    raw,
  };
}

/**
 * Resolve a `places/.../photos/...` resource name to a usable redirect URL.
 * Bills the Places Photos SKU. Skip unless you need the photo (e.g. brand color).
 */
export async function getPhotoUrl(photoName: string, maxWidth = 1200): Promise<string> {
  if (!env.GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY missing");
  const url = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  url.searchParams.set("maxWidthPx", String(maxWidth));
  url.searchParams.set("skipHttpRedirect", "true");
  url.searchParams.set("key", env.GOOGLE_PLACES_API_KEY);
  const resp = await retry(() => fetch(url, { method: "GET" }), { maxAttempts: 3 });
  if (!resp.ok) throw new Error(`places.photo.error ${resp.status}`);
  const json = (await resp.json()) as { photoUri?: string };
  return json.photoUri ?? "";
}
