/**
 * logo.ts — Pick the best logo URL for a lead. Brandfetch first, monogram fallback.
 *
 * Inputs:  business_name, website_url (optional), website_kind, brand_hex, category
 * Outputs: { logo_url: string, source: 'brandfetch' | 'monogram' }
 * Used by: lib/pipeline/stage-1-scrape.ts (initial enrichment),
 *          lib/pipeline/stage-2-enrich.ts (re-enrichment)
 *
 * Strategy:
 *   1. If website_kind === 'real' AND we have a domain → try Brandfetch.
 *   2. If Brandfetch returns nothing (or BRANDFETCH_API_KEY is blank) → monogram.
 *   3. Monogram never fails — every lead ends up with a logo URL.
 *
 * Why no FB scraping: per project policy, we don't scrape Facebook. For
 * social-only businesses, monogram is the path. The dashboard surfaces a
 * "social-only" badge so the operator can manually upload a logo via the
 * improve flow if they want to.
 */

import { getLogger } from "../logger";
import { fetchLogoForDomain } from "./brandfetch";
import { generateMonogramDataUri } from "./monogram";
import type { WebsiteKind } from "./types";

const log = getLogger("logo");

export interface LogoInput {
  business_name: string;
  /** Raw website URL Places returned, may be social/aggregator. */
  website_url?: string | null;
  website_kind?: WebsiteKind | null;
  /** Brand hex (extracted from photo or palette default). Used for the monogram bg. */
  brand_hex: string;
  /** Google Maps category — drives serif vs sans on the monogram. */
  category?: string | null;
}

export interface LogoResult {
  logo_url: string;
  source: "brandfetch" | "monogram";
}

export async function resolveLogo(input: LogoInput): Promise<LogoResult> {
  // Try Brandfetch only when we have a real owned domain — Brandfetch can't
  // resolve facebook.com/<page> reliably and we don't want to burn lookups.
  if (input.website_kind === "real" && input.website_url) {
    const url = await fetchLogoForDomain(input.website_url);
    if (url) {
      log.info({ business: input.business_name, source: "brandfetch" }, "logo.resolved");
      return { logo_url: url, source: "brandfetch" };
    }
  }
  const dataUri = generateMonogramDataUri({
    business_name: input.business_name,
    brand_hex: input.brand_hex,
    category: input.category ?? null,
  });
  log.info({ business: input.business_name, source: "monogram" }, "logo.resolved");
  return { logo_url: dataUri, source: "monogram" };
}
