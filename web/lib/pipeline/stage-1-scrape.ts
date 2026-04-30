/**
 * stage-1-scrape.ts — Pull leads from the chosen scraper, filter, persist.
 *
 * Inputs:  batch row { id, niche, city, scraper, limit, ... }
 * Outputs: rows in `leads` with stage='scraped', filtered to qualifiers only
 * Used by: lib/pipeline/orchestrator.ts
 *
 * Dispatch: batch.scraper picks the provider —
 *   - 'outscraper'    → services/outscraper.ts     (cap 500/query)
 *   - 'google_places' → services/google-places.ts  (cap 60/query, default)
 *
 * Idempotency: (place_id, batch_id) unique constraint dedupes re-runs.
 */

import { getDb } from "../db";
import { qualifies } from "../filters";
import { getLogger } from "../logger";
import * as googlePlaces from "../services/google-places";
import * as outscraper from "../services/outscraper";
import type { NormalizedLead } from "../services/types";

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
    const { passes, reason } = qualifies(
      {
        has_website: lead.has_website,
        rating: lead.rating,
        review_count: lead.review_count,
        phone: lead.phone,
        category: lead.category,
      },
      batch.niche,
    );
    if (!passes) {
      rejected += 1;
      const key = reason ?? "unknown";
      rejection_reasons[key] = (rejection_reasons[key] ?? 0) + 1;
      log.debug({ reason, name: lead.business_name }, "stage_1.reject");
      continue;
    }
    accepted += 1;
    rows.push({
      batch_id: batch.id,
      business_name: lead.business_name,
      phone: lead.phone,
      address: lead.address,
      category: lead.category,
      rating: lead.rating,
      review_count: lead.review_count,
      has_website: lead.has_website,
      photos: lead.photos,
      reviews: lead.reviews,
      place_id: lead.place_id,
      latitude: lead.latitude,
      longitude: lead.longitude,
      stage: "scraped",
    });
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
