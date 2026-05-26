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

import { fetchImageBuffer } from "./image-fetch";
import { fetchSocialPageMeta } from "./playwright-logo";
import { findSocialCandidates } from "./web-search";
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
  /** Logo as a base64 data URI captured during the guess validation —
   *  bypasses a second Playwright fetch in resolveLogo. Stored as a data
   *  URI (not the raw fbcdn URL) because signed CDN URLs expire ~3 weeks
   *  after issue, which silently breaks the deployed static site. */
  prefetched_logo_url?: string;
  /** Raw bytes of the prefetched logo — same image as the data URI above.
   *  Lets the caller derive brand color without re-downloading. */
  prefetched_logo_bytes?: Buffer;
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
/**
 * ISO 3166-1 alpha-2 → short list of names + common aliases the bio might
 * mention. We use lowercase substring matching so case-insensitivity comes
 * for free. Only includes the markets we actively prospect into — extend
 * as new batches surface other country codes.
 */
const COUNTRY_TOKENS: Record<string, string[]> = {
  US: ["united states", "usa", "u.s.a", "u.s."],
  CA: ["canada"],
  AU: ["australia"],
  NZ: ["new zealand", "aotearoa"],
  GB: ["united kingdom", "uk", "great britain", "england", "scotland", "wales"],
  IE: ["ireland", "éire"],
};

/**
 * Returns true when the page bio (og:title + og:description) mentions the
 * lead's city OR its country. Used to reject name-collision false positives
 * — generic slugs like "thelittlethings" resolve to any number of different
 * businesses (we saw three real ones with that exact handle alone). The
 * locality signal is the cheapest discriminator: a real business profile
 * almost always lists its city or country somewhere in the bio.
 *
 * Conservative: if neither city nor country is present, REJECT. Cost of a
 * false-negative is monogram fallback; cost of a false-positive is shipping
 * a stranger's profile picture as the lead's brand logo, which is worse.
 */
function pageLocalityMatches(
  bio: string,
  expectedCity: string | null,
  expectedCountry: string | null,
): { ok: boolean; matched?: "city" | "country"; token?: string } {
  const text = bio.toLowerCase();
  if (expectedCity) {
    const city = expectedCity.toLowerCase().trim();
    // City may be a multi-word phrase like "San Diego" — substring match is
    // enough; we don't need word boundaries. Filter very short city names
    // (≤3 chars) to avoid 'ny' matching 'company'.
    if (city.length >= 4 && text.includes(city)) {
      return { ok: true, matched: "city", token: expectedCity };
    }
  }
  if (expectedCountry) {
    const tokens = COUNTRY_TOKENS[expectedCountry.toUpperCase()] ?? [
      expectedCountry.toLowerCase(),
    ];
    for (const tok of tokens) {
      if (text.includes(tok)) return { ok: true, matched: "country", token: tok };
    }
  }
  return { ok: false };
}

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

/**
 * Probe a single candidate FB/IG URL: load it via Playwright, sanity-check
 * the og:image is a real CDN profile pic, then run the locality check
 * against the page bio. Returns the hit (with bytes persisted as a data
 * URI) when everything passes, null otherwise.
 */
async function probeCandidate(
  candidate: { url: string; kind: "facebook" | "instagram"; source: "web_search" | "slug_guess" },
  input: SocialSearchInput,
  context: { business: string; startMs: number },
): Promise<SocialSearchResult | null> {
  const meta = await fetchSocialPageMeta(candidate.url, candidate.kind, input.country_code);
  if (!meta) return null;
  if (!looksLikeRealProfilePic(meta.og_image, candidate.kind)) {
    log.info(
      {
        business: context.business,
        url: candidate.url,
        source: candidate.source,
        logoSample: meta.og_image.slice(0, 80),
      },
      "social_search.candidate.fallback_icon",
    );
    return null;
  }
  const bio = `${meta.og_title ?? ""} ${meta.og_description ?? ""}`;
  const locality = pageLocalityMatches(bio, input.city ?? null, input.country_code ?? null);
  if (!locality.ok) {
    log.info(
      {
        business: context.business,
        url: candidate.url,
        source: candidate.source,
        expected_city: input.city,
        expected_country: input.country_code,
        bio_preview: bio.slice(0, 120),
      },
      "social_search.candidate.locality_mismatch",
    );
    return null;
  }
  // og:image URLs are signed and expire ~3 weeks after issue (fbcdn /
  // cdninstagram). Download the bytes now and persist as a data URI so
  // the deployed static site never depends on the platform CDN.
  const img = await fetchImageBuffer(meta.og_image);
  const dataUri = img
    ? `data:${img.contentType};base64,${img.buffer.toString("base64")}`
    : meta.og_image;
  log.info(
    {
      business: context.business,
      url: candidate.url,
      kind: candidate.kind,
      source: candidate.source,
      elapsedMs: Date.now() - context.startMs,
      locality_match: locality.matched,
      locality_token: locality.token,
      persisted: !!img,
    },
    "social_search.candidate.accepted",
  );
  return {
    url: candidate.url,
    kind: candidate.kind,
    prefetched_logo_url: dataUri,
    prefetched_logo_bytes: img?.buffer,
  };
}

export async function findSocialUrl(
  input: SocialSearchInput,
): Promise<SocialSearchResult | null> {
  const startMs = Date.now();
  const ctx = { business: input.business_name, startMs };

  // Step 1: search the open web for the business name + city. Most active
  // local businesses rank their real FB/IG page in the top results, which
  // means we land on the right handle even when it's an unguessable slug
  // (e.g. "thelittlethingskids" — has a "kids" suffix that isn't in the
  // business name). Each candidate still passes through the locality
  // check before we accept it, so a name-collision business in a
  // different city won't slip through.
  const webCandidates = await findSocialCandidates(input.business_name, input.city ?? null);
  for (const cand of webCandidates) {
    const hit = await probeCandidate({ ...cand, source: "web_search" }, input, ctx);
    if (hit) return hit;
  }

  // Step 2: slug-guess fallback for businesses with no SERP footprint.
  // Slug variants are pure name-derived ("the-little-things-…", "thelittle",
  // "thelittlethings"), so they mostly catch businesses whose handle IS
  // their business name. FB first — its profile pictures tend to crop
  // more flatteringly. country_code drives the residential-proxy egress
  // so FB/IG return localized content rather than a stripped page.
  const slugs = slugCandidates(input.business_name);
  if (slugs.length === 0) {
    log.info(
      { business: input.business_name, web_candidates: webCandidates.length, elapsedMs: Date.now() - startMs },
      "social_search.no_slugs",
    );
    return null;
  }
  for (const kind of ["facebook", "instagram"] as const) {
    for (const slug of slugs) {
      const url = `https://www.${kind}.com/${slug}`;
      const hit = await probeCandidate({ url, kind, source: "slug_guess" }, input, ctx);
      if (hit) return hit;
    }
  }

  log.info(
    {
      business: input.business_name,
      web_candidates: webCandidates.length,
      slug_count: slugs.length,
      elapsedMs: Date.now() - startMs,
    },
    "social_search.miss",
  );
  return null;
}
