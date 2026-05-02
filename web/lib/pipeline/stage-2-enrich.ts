/**
 * stage-2-enrich.ts — Re-enrich a single lead's brand_color (and later, email).
 *
 * Inputs:  lead row at stage='scraped' or 'enriched'
 * Outputs: same row updated with brand_color, email (if found), stage='enriched'
 * Used by: lib/pipeline/build-lead.ts (idempotent), /api/leads/:id/regenerate
 *
 * Note: Stage 1 now performs initial enrichment at scrape time, so most
 * leads already arrive here at stage='enriched' with brand_color set. This
 * stage is the re-enrichment path: forced regenerations, or leads scraped
 * before the stage-1 enrichment migration. Skips photo extraction if
 * brand_color is already set.
 *
 * Idempotent: re-running just overwrites brand_color / email.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import { extractBrandColor, FALLBACK_HEX } from "../services/color-extractor";
import { getPhotoUrl } from "../services/google-places";
import { resolveLogo } from "../services/logo";
import type { WebsiteKind } from "../services/types";

const log = getLogger("stage-2");

export interface Lead {
  id: string;
  business_name: string;
  brand_color: string | null;
  email: string | null;
  photos: Array<{ name?: string; url?: string }>;
  batch_id: string;
  /** Optional context for logo resolution — populated by stage-1 onward. */
  category?: string | null;
  website_url?: string | null;
  website_kind?: WebsiteKind | null;
  logo_url?: string | null;
}

export async function run(
  lead: Lead,
): Promise<{ brand_color: string | null; email: string | null; logo_url: string | null }> {
  log.info({ lead_id: lead.id, name: lead.business_name }, "stage_2.start");

  let brandColor = lead.brand_color;
  if (!brandColor && lead.photos?.length) {
    const first = lead.photos[0];
    let src = first.url ?? null;

    // Google Places photos: resolve resource name → redirect URL (extra cost)
    if (!src && first.name) {
      try {
        src = await getPhotoUrl(first.name);
      } catch (err) {
        log.warn({ err: String(err) }, "stage_2.photo_resolve_failed");
      }
    }

    if (src) brandColor = await extractBrandColor(src);
  }

  // Logo enrichment: Brandfetch first (when real domain), monogram fallback.
  // Idempotent — overwrites lead.logo_url every time so an upgraded
  // Brandfetch index or a brand_color change is reflected on next re-enrich.
  let logoUrl: string | null = lead.logo_url ?? null;
  try {
    const { logo_url } = await resolveLogo({
      business_name: lead.business_name,
      website_url: lead.website_url ?? null,
      website_kind: lead.website_kind ?? null,
      brand_hex: brandColor ?? FALLBACK_HEX,
      category: lead.category ?? null,
    });
    logoUrl = logo_url;
  } catch (err) {
    log.warn({ err: String(err) }, "stage_2.logo_failed");
  }

  // Email lookup is a TODO: integrate Hunter / Apollo here.
  const email = lead.email;

  const { error } = await getDb()
    .from("leads")
    .update({ brand_color: brandColor, email, logo_url: logoUrl, stage: "enriched" })
    .eq("id", lead.id);
  if (error) throw new Error(`stage_2.persist.error: ${error.message}`);

  log.info({ lead_id: lead.id, brand_color: brandColor, logo_source: logoUrl?.startsWith("data:") ? "monogram" : "brandfetch" }, "stage_2.done");
  return { brand_color: brandColor, email, logo_url: logoUrl };
}
