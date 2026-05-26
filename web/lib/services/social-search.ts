/**
 * social-search.ts — Find a business's Facebook or Instagram URL when
 * Google Places doesn't surface one, via direct URL guessing.
 *
 * Inputs:  business_name, optional city, optional country_code
 * Outputs: { url, kind, prefetched_logo_url? } on guess hit, null otherwise
 * Used by: lib/pipeline/stage-2-enrich.ts (only when website_kind is null/none)
 *
 * Strategy: skip search engines entirely (all free options either bot-
 * block us or CAPTCHA us; the paid Google CSE doesn't allow site-
 * restricted engines on JSON API). Instead, slugify the business name
 * into a few likely-handle variants and try each as a direct profile
 * URL on Facebook then Instagram. For each guess, the existing
 * Playwright og:image fetcher (lib/services/playwright-logo.ts)
 * navigates to it and reads the profile picture. If the picture looks
 * like a real CDN-hosted profile pic (not a platform fallback / generic
 * icon), we count it as a hit.
 *
 * Expected hit rate: ~20-40% for businesses with predictable handles.
 * Remaining leads stay with the monogram default. Operator UI can paste
 * a known URL for any lead the guess missed (separate increment).
 *
 * Wall time per lead: each slug-platform combo costs ~2-4s. We cap at
 * 4 slug variants × 2 platforms = 8 fetches worst case, ~16-30s. We
 * bail at the first hit, so a quick match returns in ~3s.
 *
 * Cost: zero new API spend. Reuses the headless Chromium singleton
 * shipped in lib/services/headless-browser.ts.
 */

import { fetchLogoFromSocial } from "./playwright-logo";
import { getLogger } from "../logger";

const log = getLogger("social-search");

/** Maximum number of slug variants to try per platform. */
const MAX_VARIANTS = 4;

export interface SocialSearchInput {
  business_name: string;
  city?: string | null;
  country_code?: string | null;
}

export interface SocialSearchResult {
  url: string;
  kind: "facebook" | "instagram";
  /** og:image URL captured during the guess validation — caller can use
   *  this directly to avoid a second Playwright fetch in resolveLogo. */
  prefetched_logo_url?: string;
}

/**
 * Generate candidate URL slugs from a business name in order of most-likely.
 *
 * Examples:
 *   "The Little Things | Balloon Garlands & Event Styling Hamilton" →
 *     ["the-little-things-balloon-garlands-and-event-styling-hamilton",
 *      "thelittlethingsballoongarlandsandeventstylinghamilton",
 *      "thelittle",
 *      "thelittlethings"]
 *
 *   "Joe's Plumbing" →
 *     ["joes-plumbing",
 *      "joesplumbing",
 *      "joes"]  // unlikely to be useful as IG handle but cheap to try
 */
function slugCandidates(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['']/g, "")          // strip apostrophes: Joe's → Joes
    .replace(/[^a-z0-9\s-]/g, " ") // anything else → space
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return [];

  const candidates = new Set<string>();
  // 1. All words, kebab-case — common FB page slug.
  candidates.add(words.join("-"));
  // 2. All words concatenated, no separator — common IG handle shape.
  candidates.add(words.join(""));
  // 3. First 2 words concatenated — short handle pattern.
  if (words.length >= 2) candidates.add(words.slice(0, 2).join(""));
  // 4. First 3 words concatenated.
  if (words.length >= 3) candidates.add(words.slice(0, 3).join(""));

  return Array.from(candidates)
    .filter((s) => s.length >= 3 && s.length <= 60)
    .slice(0, MAX_VARIANTS);
}

/**
 * Returns true if an og:image URL looks like a real CDN-hosted profile
 * picture, vs. a platform fallback icon for a nonexistent page.
 *
 * Real-pic signatures (verified against live data):
 *   - IG profile pic: scontent.cdninstagram.com/v/t51.2885-19/...
 *   - FB profile pic: scontent.<region>.fbcdn.net/v/t39.30808-1/...
 *
 * Fallback / non-profile-pic indicators:
 *   - static.cdninstagram.com/...    (generic IG icon)
 *   - facebook.com/images/...        (FB header logo)
 *   - missing CDN signature path     (page didn't exist; default returned)
 */
function looksLikeRealProfilePic(
  logoUrl: string,
  kind: "facebook" | "instagram",
): boolean {
  if (kind === "instagram") {
    if (logoUrl.includes("static.cdninstagram.com")) return false;
    // Real IG pics use the t51.2885-19 namespace (profile picture format
    // identifier). Posts use t51.29350-15 etc — those would be fine too
    // because we don't navigate to /p/<post> URLs. Stay lenient with a
    // simple cdninstagram OR fbcdn host check.
    return logoUrl.includes("cdninstagram.com") || logoUrl.includes("fbcdn.net");
  }
  if (kind === "facebook") {
    // Real FB profile pics live on fbcdn.net with the t39.30808-1 namespace
    // identifier. Anything else (favicon, default page graphics) is rejected.
    if (!logoUrl.includes("fbcdn.net")) return false;
    if (!logoUrl.includes("/t39.30808-1/")) return false;
    return true;
  }
  return false;
}

export async function findSocialUrl(
  input: SocialSearchInput,
): Promise<SocialSearchResult | null> {
  const startMs = Date.now();
  const slugs = slugCandidates(input.business_name);

  if (slugs.length === 0) {
    log.info({ business: input.business_name }, "social_search.no_slugs");
    return null;
  }

  // FB first — its profile pictures tend to be higher resolution + crop
  // more flatteringly. If FB misses, try IG. The lead's country_code is
  // forwarded to the Playwright fetcher so the residential proxy picks an
  // egress IP in the right region (FB/IG show different content to non-
  // matching countries — a NZ business viewed from a US IP can return a
  // generic page).
  for (const kind of ["facebook", "instagram"] as const) {
    for (const slug of slugs) {
      const url = `https://www.${kind}.com/${slug}`;
      const logo = await fetchLogoFromSocial(url, kind, input.country_code);
      if (!logo) continue;
      if (!looksLikeRealProfilePic(logo, kind)) {
        log.info(
          { business: input.business_name, slug, kind, logoSample: logo.slice(0, 80) },
          "social_search.guess.fallback_icon",
        );
        continue;
      }
      log.info(
        { business: input.business_name, slug, url, kind, elapsedMs: Date.now() - startMs },
        "social_search.guess_hit",
      );
      return { url, kind, prefetched_logo_url: logo };
    }
  }

  log.info(
    { business: input.business_name, slug_count: slugs.length, elapsedMs: Date.now() - startMs },
    "social_search.guess_miss",
  );
  return null;
}
