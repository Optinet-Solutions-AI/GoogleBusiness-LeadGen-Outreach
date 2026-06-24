/**
 * logo.ts — Pick the best logo URL for a lead.
 *
 * Inputs:  business_name, website_url (optional), website_kind, brand_hex, category
 * Outputs: { logo_url: string, source: 'brandfetch' | 'facebook' | 'instagram' | 'monogram' }
 * Used by: lib/pipeline/stage-1-scrape.ts (initial enrichment),
 *          lib/pipeline/stage-2-enrich.ts (re-enrichment)
 *
 * Strategy (most authentic → least), all free except Brandfetch's free tier:
 *   1. website_kind === 'real' AND we have a domain → try Brandfetch.
 *   2. Any website_url → scrape the page directly (plain fetch, no headless
 *      browser): a real site's header <img> logo, or a facebook/instagram
 *      og:image profile picture via the crawler UA. Catches the leads
 *      Brandfetch has no record for. See website-brand.ts.
 *   3. facebook/instagram → headless Chromium og:image (deeper fallback when
 *      step 2's lightweight fetch is empty). See playwright-logo.ts.
 *   4. Otherwise → monogram (initials in the brand color, never fails).
 *
 * Previous policy in this file (now superseded): "Why no FB scraping…"
 * The operator explicitly requested logos for social-only businesses for
 * uniqueness. We render via headless Chromium and read the public og:image
 * — same data anyone visiting the page in a normal browser would see.
 * Limits and ToS-gray-area details live in playwright-logo.ts.
 */

import { getLogger } from "../logger";
import { fetchLogoForDomain } from "./brandfetch";
import { fetchImageBuffer } from "./image-fetch";
import { generateMonogramDataUri } from "./monogram";
import { fetchLogoFromSocial } from "./playwright-logo";
import { extractWebsiteBrand } from "./website-brand";
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
  /** ISO 3166-1 alpha-2 — picks the residential proxy egress country
   *  for the Playwright FB/IG fetch. Falls back to PROXY_DEFAULT_COUNTRY. */
  country_code?: string | null;
}

export interface LogoResult {
  logo_url: string;
  source: "brandfetch" | "website" | "facebook" | "instagram" | "monogram";
  /** Raw image bytes when we just downloaded them — exposed so callers can
   *  derive brand color without paying for a second network round-trip.
   *  Null when the logo is a monogram SVG or when bytes weren't fetched
   *  (Brandfetch CDN — we don't download those, their URLs are stable). */
  logo_bytes?: Buffer | null;
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

  // 2. Scrape the logo straight off the business's own page — FREE (plain
  //    fetch + regex, no paid API, no headless browser):
  //      • real website → its header <img> logo (catches the leads Brandfetch
  //        has no record for)
  //      • facebook / instagram → the og:image profile picture via the standard
  //        crawler UA (the link-preview path)
  //    We download the bytes and inline them as a data URI so the deployed
  //    static site never depends on a hotlink / signed URL that can expire.
  if (input.website_url) {
    try {
      const { logo_url } = await extractWebsiteBrand(input.website_url);
      if (logo_url) {
        const source: LogoResult["source"] =
          input.website_kind === "facebook" || input.website_kind === "instagram"
            ? input.website_kind
            : "website";
        const img = await fetchImageBuffer(logo_url);
        if (img) {
          const dataUri = `data:${img.contentType};base64,${img.buffer.toString("base64")}`;
          log.info(
            { business: input.business_name, source, bytes: img.buffer.byteLength },
            "logo.resolved.website_scrape",
          );
          return { logo_url: dataUri, source, logo_bytes: img.buffer };
        }
        log.info({ business: input.business_name, source }, "logo.resolved.website_scrape.url");
        return { logo_url, source };
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 120) }, "logo.website_scrape_failed");
    }
  }

  // 3. Facebook or Instagram URL → headless Chromium reads og:image (deeper
  //    fallback when the lightweight crawler-UA fetch above came up empty).
  // Catches the ~half of small businesses that don't have a real website
  // but DO have a Facebook page or Instagram presence with a real logo.
  //
  // The og:image URL returned by FB/IG is signed and expires ~3-4 weeks
  // after issue. Storing the URL directly causes broken images on the
  // deployed static site once the signature times out. We download the
  // bytes immediately and inline them as a data URI so the deployed HTML
  // never depends on the platform CDN.
  if (
    (input.website_kind === "facebook" || input.website_kind === "instagram") &&
    input.website_url
  ) {
    const url = await fetchLogoFromSocial(
      input.website_url,
      input.website_kind,
      input.country_code,
    );
    if (url) {
      const img = await fetchImageBuffer(url);
      if (img) {
        const dataUri = `data:${img.contentType};base64,${img.buffer.toString("base64")}`;
        log.info(
          { business: input.business_name, source: input.website_kind, bytes: img.buffer.byteLength },
          "logo.resolved.persisted",
        );
        return { logo_url: dataUri, source: input.website_kind, logo_bytes: img.buffer };
      }
      // Download failed but we have a (probably still-valid) signed URL —
      // use it as a last resort. Site will work for ~3 weeks, then break.
      log.warn(
        { business: input.business_name, source: input.website_kind },
        "logo.resolved.persist_failed.using_url",
      );
      return { logo_url: url, source: input.website_kind };
    }
  }

  // 4. Monogram — never fails.
  const dataUri = generateMonogramDataUri({
    business_name: input.business_name,
    brand_hex: input.brand_hex,
    category: input.category ?? null,
  });
  log.info({ business: input.business_name, source: "monogram" }, "logo.resolved");
  return { logo_url: dataUri, source: "monogram" };
}
