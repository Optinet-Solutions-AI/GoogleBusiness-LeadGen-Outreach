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
 *   2. Any website_url → plain-fetch scrape (no browser): a real site's header
 *      <img> logo, or a facebook/instagram og:image profile picture via the
 *      crawler UA. See website-brand.ts.
 *   3. Real website, still nothing → headless render to read the navbar logo
 *      (catches SPA/JS sites). Never a favicon. See playwright-website-logo.ts.
 *   4. facebook/instagram → headless Chromium og:image (deeper social
 *      fallback). See playwright-logo.ts.
 *   5. Otherwise → monogram (initials in the brand color, never fails).
 * Favicons / apple-touch-icons are used for brand COLOR only, never displayed
 * as the logo (too often a generic icon).
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
import { fetchWebsiteLogo } from "./playwright-website-logo";
import { trimTransparentPadding } from "./logo-trim";
import { extractWebsiteBrand } from "./website-brand";
import type { WebsiteKind } from "./types";

const log = getLogger("logo");

/** Download a logo, trim its transparent padding (PNG logos often ship as a
 *  small mark in a big transparent square), and inline it as a data URI so the
 *  deployed static page never depends on a hotlink / signed URL. */
async function inlineLogo(url: string): Promise<{ dataUri: string; bytes: Buffer } | null> {
  const img = await fetchImageBuffer(url);
  if (!img) return null;
  let buffer = img.buffer;
  if (/png/i.test(img.contentType)) {
    const trimmed = trimTransparentPadding(buffer);
    if (trimmed) buffer = trimmed;
  }
  return { dataUri: `data:${img.contentType};base64,${buffer.toString("base64")}`, bytes: buffer };
}

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
  let parked = false;
  if (input.website_url) {
    try {
      const brand = await extractWebsiteBrand(input.website_url);
      parked = !!brand.parked;
      const { logo_url } = brand;
      if (logo_url) {
        const source: LogoResult["source"] =
          input.website_kind === "facebook" || input.website_kind === "instagram"
            ? input.website_kind
            : "website";
        const inlined = await inlineLogo(logo_url);
        if (inlined) {
          log.info(
            { business: input.business_name, source, bytes: inlined.bytes.byteLength },
            "logo.resolved.website_scrape",
          );
          return { logo_url: inlined.dataUri, source, logo_bytes: inlined.bytes };
        }
        log.info({ business: input.business_name, source }, "logo.resolved.website_scrape.url");
        return { logo_url, source };
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 120) }, "logo.website_scrape_failed");
    }
  }

  // 3. Real website but no logo yet — modern SPA sites (Lovable/React/Wix)
  //    render their navbar logo client-side, so the plain fetch above saw
  //    none and would otherwise fall to a generic favicon. Render the page
  //    headlessly and read the actual header logo. Returns null (→ monogram)
  //    rather than a favicon when the site has no real <img> logo.
  if (input.website_kind === "real" && input.website_url && !parked) {
    const found = await fetchWebsiteLogo(input.website_url, input.country_code);
    if (found) {
      // Prefer the bytes the browser already fetched (bypasses bot protection),
      // trim transparent padding, and inline. Fall back to a server-side
      // download, then to hotlinking the URL.
      if (found.base64) {
        let buffer: Buffer = Buffer.from(found.base64, "base64");
        const ct = found.contentType || "image/png";
        if (/png/i.test(ct)) {
          const trimmed = trimTransparentPadding(buffer);
          if (trimmed) buffer = trimmed;
        }
        log.info({ business: input.business_name, source: "website", bytes: buffer.byteLength }, "logo.resolved.headless");
        return { logo_url: `data:${ct};base64,${buffer.toString("base64")}`, source: "website", logo_bytes: buffer };
      }
      const inlined = await inlineLogo(found.src);
      if (inlined) {
        return { logo_url: inlined.dataUri, source: "website", logo_bytes: inlined.bytes };
      }
      log.info({ business: input.business_name, source: "website" }, "logo.resolved.headless.url");
      return { logo_url: found.src, source: "website" };
    }
  }

  // 4. Facebook or Instagram URL → headless Chromium reads og:image (deeper
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
      const inlined = await inlineLogo(url);
      if (inlined) {
        log.info(
          { business: input.business_name, source: input.website_kind, bytes: inlined.bytes.byteLength },
          "logo.resolved.persisted",
        );
        return { logo_url: inlined.dataUri, source: input.website_kind, logo_bytes: inlined.bytes };
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

  // 5. Monogram — never fails.
  const dataUri = generateMonogramDataUri({
    business_name: input.business_name,
    brand_hex: input.brand_hex,
    category: input.category ?? null,
  });
  log.info({ business: input.business_name, source: "monogram" }, "logo.resolved");
  return { logo_url: dataUri, source: "monogram" };
}
