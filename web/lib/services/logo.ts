/**
 * logo.ts — Pick the best logo URL for a lead.
 *
 * Inputs:  business_name, website_url (optional), website_kind, brand_hex, category
 * Outputs: { logo_url: string, source: 'brandfetch' | 'facebook' | 'instagram' | 'monogram' }
 * Used by: lib/pipeline/stage-1-scrape.ts (initial enrichment),
 *          lib/pipeline/stage-2-enrich.ts (re-enrichment)
 *
 * Strategy (most authentic → least):
 *   1. website_kind === 'real' AND we have a domain → try Brandfetch.
 *   2. website_kind === 'facebook' OR 'instagram' AND we have a URL →
 *      headless Chromium reads the page's og:image (the profile picture).
 *      See playwright-logo.ts for honest limits at scale.
 *   3. Otherwise → monogram (initials in the brand color, never fails).
 *
 * Previous policy in this file (now superseded): "Why no FB scraping…"
 * The operator explicitly requested logos for social-only businesses for
 * uniqueness. We render via headless Chromium and read the public og:image
 * — same data anyone visiting the page in a normal browser would see.
 * Limits and ToS-gray-area details live in playwright-logo.ts.
 */

import { getLogger } from "../logger";
import { fetchLogoForDomain } from "./brandfetch";
import { generateMonogramDataUri } from "./monogram";
import { fetchLogoFromSocial } from "./playwright-logo";
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
  source: "brandfetch" | "facebook" | "instagram" | "monogram";
}

export async function resolveLogo(input: LogoInput): Promise<LogoResult> {
  // 1. Real owned domain → Brandfetch.
  if (input.website_kind === "real" && input.website_url) {
    const url = await fetchLogoForDomain(input.website_url);
    if (url) {
      log.info({ business: input.business_name, source: "brandfetch" }, "logo.resolved");
      return { logo_url: url, source: "brandfetch" };
    }
  }

  // 2. Facebook or Instagram URL → headless Chromium reads og:image.
  // Catches the ~half of small businesses that don't have a real website
  // but DO have a Facebook page or Instagram presence with a real logo.
  if (
    (input.website_kind === "facebook" || input.website_kind === "instagram") &&
    input.website_url
  ) {
    const url = await fetchLogoFromSocial(input.website_url, input.website_kind);
    if (url) {
      log.info(
        { business: input.business_name, source: input.website_kind },
        "logo.resolved",
      );
      return { logo_url: url, source: input.website_kind };
    }
  }

  // 3. Monogram — never fails.
  const dataUri = generateMonogramDataUri({
    business_name: input.business_name,
    brand_hex: input.brand_hex,
    category: input.category ?? null,
  });
  log.info({ business: input.business_name, source: "monogram" }, "logo.resolved");
  return { logo_url: dataUri, source: "monogram" };
}
