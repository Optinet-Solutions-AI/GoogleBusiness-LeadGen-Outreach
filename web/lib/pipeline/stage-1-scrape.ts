/**
 * stage-1-scrape.ts — Pull leads from the chosen scraper, filter, enrich, persist.
 *
 * Inputs:  batch row { id, niche, city, scraper, limit, ... }
 * Outputs: rows in `leads` with stage='enriched' (qualified) or 'scraped' (rejected)
 * Used by: lib/pipeline/orchestrator.ts
 *
 * Dispatch: batch.scraper picks the provider —
 *   - 'outscraper'    → services/outscraper.ts     (cap 500/query)
 *   - 'google_places' → services/google-places.ts  (cap 60/query, default)
 *
 * Enrichment (qualified rows only):
 *   - brand_color from first photo (Vibrant). For Places, resolves the photo
 *     resource name to a redirect URL first (bills the Photos SKU, ~$0.007/lead).
 *   - Runs in parallel with concurrency=5 to avoid rate limits.
 *   - On any failure, brand_color stays null and the row still moves to
 *     stage='enriched' — downstream stages have a fallback hex.
 *
 * Idempotency: (place_id, batch_id) unique constraint dedupes re-runs.
 */

import { getDb } from "../db";
import { qualifies } from "../filters";
import { getLogger } from "../logger";
import { extractBrandColor, FALLBACK_HEX } from "../services/color-extractor";
import * as googlePlaces from "../services/google-places";
import { resolveLogo } from "../services/logo";
import * as outscraper from "../services/outscraper";
import type { NormalizedLead, WebsiteKind } from "../services/types";

const ENRICH_CONCURRENCY = 5;

const log = getLogger("stage-1");

export interface Batch {
  id: string;
  niche: string;
  city: string;
  scraper: "google_places" | "outscraper";
  limit: number | null;
  template_slug: string;
  /** ISO 3166-1 alpha-2 (lowercase). Optional for legacy rows that predate
   *  migration 008 — defaults to 'us'. */
  country_code?: string | null;
}

export async function run(batch: Batch): Promise<{
  accepted: number;
  rejected: number;
  rejection_reasons: Record<string, number>;
}> {
  const limit = batch.limit ?? 100;
  const query = `${batch.niche} in ${batch.city}`;
  // Bias the scrape to the batch's country. Places wants lowercase ISO,
  // Outscraper expects uppercase — handle both shapes here.
  const region = (batch.country_code ?? "us").toLowerCase();
  log.info({ batch_id: batch.id, query, limit, scraper: batch.scraper, region }, "stage_1.start");

  let raw: NormalizedLead[];
  if (batch.scraper === "outscraper") {
    raw = await outscraper.searchGoogleMaps({ query, limit, region: region.toUpperCase() });
  } else if (batch.scraper === "google_places") {
    raw = await googlePlaces.searchText({ query, limit, region });
  } else {
    throw new Error(`unknown scraper: ${batch.scraper}`);
  }

  let accepted = 0;
  let rejected = 0;
  const rejection_reasons: Record<string, number> = {};
  const rows: Record<string, unknown>[] = [];
  for (const lead of raw) {
    const { passes, reason, detail } = qualifies(
      {
        has_website: lead.has_website,
        rating: lead.rating,
        review_count: lead.review_count,
        phone: lead.phone,
        category: lead.category,
        business_name: lead.business_name,
        business_status: lead.business_status,
      },
      batch.niche,
    );

    // Common columns for both qualified and rejected rows. Rejected leads
    // get persisted too (qualified=false) so the operator can see WHY each
    // lead was rejected on the batch detail page instead of just a count.
    const baseRow: Record<string, unknown> = {
      batch_id: batch.id,
      business_name: lead.business_name,
      phone: lead.phone,
      address: lead.address,
      category: lead.category,
      rating: lead.rating,
      review_count: lead.review_count,
      has_website: lead.has_website,
      website_url: lead.website,
      website_kind: lead.website_kind,
      business_status: lead.business_status,
      is_service_area_only: lead.is_service_area_only,
      photos: lead.photos,
      reviews: lead.reviews,
      place_id: lead.place_id,
      latitude: lead.latitude,
      longitude: lead.longitude,
      stage: "scraped",
    };

    if (!passes) {
      rejected += 1;
      const key = reason ?? "unknown";
      rejection_reasons[key] = (rejection_reasons[key] ?? 0) + 1;
      log.debug({ reason, detail, name: lead.business_name }, "stage_1.reject");
      rows.push({
        ...baseRow,
        qualified: false,
        rejection_reason: detail ? `${key}: ${detail}` : key,
        // Rejected leads stay at stage='scraped' but qualified=false guards
        // them out of every downstream pipeline stage (build, outreach…).
      });
      continue;
    }

    accepted += 1;
    rows.push({ ...baseRow, qualified: true, rejection_reason: null });
  }

  // Enrich qualified rows in-place (brand_color + stage='enriched') before
  // upsert so the operator sees ready-to-build leads in the dashboard. No
  // network calls for rejected rows.
  const qualifiedRows = rows.filter((r) => r.qualified === true);
  if (qualifiedRows.length) {
    log.info({ count: qualifiedRows.length }, "stage_1.enrich_start");
    await enrichInParallel(qualifiedRows, batch.scraper);
    log.info({ count: qualifiedRows.length }, "stage_1.enrich_done");
  }

  if (rows.length) {
    const { error } = await getDb()
      .from("leads")
      .upsert(rows, { onConflict: "place_id,batch_id" });
    if (error) throw new Error(`stage_1.persist.error: ${error.message}`);
  }

  log.info({ batch_id: batch.id, accepted, rejected, rejection_reasons }, "stage_1.done");
  return { accepted, rejected, rejection_reasons };
}

/**
 * Mutate each row to add { brand_color, stage:'enriched' } using the first
 * photo. Concurrency-limited so we don't hammer the Places Photos endpoint.
 * Failures are swallowed — the row still graduates to stage='enriched' with
 * a null brand_color (downstream uses FALLBACK_HEX).
 */
async function enrichInParallel(
  rows: Record<string, unknown>[],
  scraper: "google_places" | "outscraper",
): Promise<void> {
  const queue = [...rows];
  const workers = Array.from(
    { length: Math.min(ENRICH_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        const row = queue.shift();
        if (!row) break;
        await enrichOne(row, scraper);
      }
    },
  );
  await Promise.all(workers);
}

async function enrichOne(
  row: Record<string, unknown>,
  scraper: "google_places" | "outscraper",
): Promise<void> {
  const photos = (row.photos as Array<{ name?: string; url?: string }> | undefined) ?? [];
  const first = photos[0];
  let src: string | null = first?.url ?? null;

  // Places returns photo resource names; resolve to a redirect URL.
  if (!src && first?.name && scraper === "google_places") {
    try {
      src = await googlePlaces.getPhotoUrl(first.name);
    } catch (err) {
      log.warn({ err: String(err) }, "stage_1.photo_resolve_failed");
    }
  }

  if (src) {
    try {
      row.brand_color = await extractBrandColor(src);
    } catch (err) {
      log.warn({ err: String(err) }, "stage_1.color_failed");
    }
  }

  // Resolve a logo (Brandfetch when real domain, monogram otherwise).
  // Never throws — monogram fallback handles every error path.
  try {
    const brandHex = (row.brand_color as string | undefined) ?? FALLBACK_HEX;
    const { logo_url } = await resolveLogo({
      business_name: row.business_name as string,
      website_url: (row.website_url as string | null) ?? null,
      website_kind: (row.website_kind as WebsiteKind | null) ?? null,
      brand_hex: brandHex,
      category: (row.category as string | null) ?? null,
    });
    row.logo_url = logo_url;
  } catch (err) {
    log.warn({ err: String(err) }, "stage_1.logo_failed");
  }

  row.stage = "enriched";
}
