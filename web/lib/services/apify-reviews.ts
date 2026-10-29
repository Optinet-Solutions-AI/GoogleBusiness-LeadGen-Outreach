/**
 * apify-reviews.ts — a few real Google reviews for one place (Apify "Google Maps Reviews Scraper").
 *
 * Inputs:  a Google place id (27+ chars, "ChIJ…"), how many reviews (default 10)
 * Outputs: { reviews: PlaceReview[] ({ text, rating, author }), costUsd } with text verbatim and author shortened to "First L."
 * Used by: lib/clients/build-brain.ts (a Brand Brain build from a Google Maps lead that has no reviews yet)
 *
 * Our stage-1 actor (google-maps-with-contact-details) cannot return reviews, so the review post type had
 * nothing to quote. This runs compass/google-maps-reviews-scraper once per client, synchronously, with a
 * hard charge cap. Pay per event: ~$0.0006 per review + $0.00005 start → 10 reviews ≈ $0.006.
 * Docs: https://apify.com/compass/google-maps-reviews-scraper
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { retry } from "@/lib/retry";

const log = getLogger("apify-reviews");
const ACTOR = "compass~google-maps-reviews-scraper";
const URL_BASE = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;
/** Hard stop on what one call may charge (10 reviews ≈ $0.006). */
const MAX_CHARGE_USD = 0.02;
const TIMEOUT_SECS = 120;
const USD_PER_REVIEW = 0.0006;
const USD_PER_START = 0.00005;

export type PlaceReview = { text: string; rating: number | null; author: string };

type RawReview = { text?: string | null; stars?: number | null; name?: string | null };

/** A Google place id we can look up (stage-1 synthetic ids like "warn:…" / "sec:…" are not). Pure. */
export function isGooglePlaceId(id: string | null | undefined): id is string {
  return !!id && /^[A-Za-z0-9_-]{20,}$/.test(id) && !id.includes(":");
}

/** "Maria Lopez Garcia" → "Maria L."; one word stays as is; blank → null. Pure. */
export function shortAuthor(name: string | null | undefined): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Keep reviews with text and a reviewer; best-rated first (stable), capped. Pure. */
export function toPlaceReviews(raw: RawReview[], max: number): PlaceReview[] {
  const out: PlaceReview[] = [];
  for (const r of raw) {
    const text = (r.text ?? "").trim();
    const author = shortAuthor(r.name);
    if (!text || !author) continue;
    out.push({ text, rating: typeof r.stars === "number" ? r.stars : null, author });
  }
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.rating ?? 0) - (a.r.rating ?? 0) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.r);
}

/** Estimated charge for a call that scraped `n` reviews (Apify bills each one, kept or not). Pure. */
export function reviewsCostUsd(n: number): number {
  return USD_PER_START + n * USD_PER_REVIEW;
}

export async function fetchPlaceReviews(
  placeId: string,
  opts: { max?: number; language?: string } = {},
): Promise<{ reviews: PlaceReview[]; costUsd: number }> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN missing");
  const max = opts.max ?? 10;
  const started = Date.now();
  const url = `${URL_BASE}?token=${env.APIFY_TOKEN}&timeout=${TIMEOUT_SECS}&maxTotalChargeUsd=${MAX_CHARGE_USD}`;
  const res = await retry(
    () =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeIds: [placeId],
          // pull a few extra so ones without text can be skipped
          maxReviews: max * 2,
          reviewsSort: "mostRelevant",
          reviewsOrigin: "google",
          language: opts.language ?? "en",
          // reviewer display name — needed for the review post's author line (shortened before storing)
          personalData: true,
        }),
        signal: AbortSignal.timeout((TIMEOUT_SECS + 15) * 1000),
      }),
    { maxAttempts: 2 },
  );
  if (!res.ok) {
    log.warn({ placeId, status: res.status, ms: Date.now() - started }, "apify_reviews.error");
    throw new Error(`apify reviews ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as unknown;
  const raw = Array.isArray(body) ? (body as RawReview[]) : [];
  const reviews = toPlaceReviews(raw, max);
  const costUsd = reviewsCostUsd(raw.length);
  log.info({ placeId, scraped: raw.length, kept: reviews.length, costUsd, ms: Date.now() - started }, "apify_reviews.done");
  return { reviews, costUsd };
}
