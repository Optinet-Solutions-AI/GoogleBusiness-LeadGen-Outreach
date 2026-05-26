/**
 * social-search.ts — Find a business's Facebook or Instagram URL when
 * Google Places doesn't surface one.
 *
 * Inputs:  business_name, optional city, optional country_code
 * Outputs: { url, kind } if a confident match is found, null otherwise
 * Used by: lib/pipeline/stage-2-enrich.ts (only when website_kind is null/none)
 *
 * Strategy: Google Custom Search API (the official, no-CAPTCHA, free-tier
 * path). We tried headless-browser searches against DuckDuckGo and Bing
 * first; both fingerprinted our requests and either soft-blocked (DDG 202)
 * or served a CAPTCHA (Bing). The CSE API is the only stable production
 * primitive without paying for proxy rotation or a SERP service.
 *
 * Setup is per-project (see lib/config.ts for the env vars): one CSE
 * scoped to facebook.com + instagram.com, an API key with Custom Search
 * enabled. Free quota: 100 queries/day. Soft-fails to null when env vars
 * are blank (i.e. the operator hasn't set up CSE yet).
 *
 * Two queries per lead (parallel):
 *   site:facebook.com "<business_name>" <city>
 *   site:instagram.com "<business_name>" <city>
 *
 * For each platform, take the first result that:
 *   1. Lives directly on facebook.com / instagram.com
 *   2. Points to a profile-shaped path (not /posts/, /events/,
 *      /watch/, /explore/, /accounts/login/, etc.)
 *
 * Returns FB when found (FB pages tend to expose a higher-quality og:image
 * via the page's actual profile picture). Falls through to IG.
 *
 * HONEST RISKS:
 *   1. False matches. "The Little Things" matches many unrelated pages.
 *      We disambiguate via city + country in the query but the result
 *      itself isn't filtered. Operator UI override is the follow-up.
 *   2. CSE has a hard daily quota. Once exceeded, returns 429 → null.
 *   3. Results cached on lead.website_url + lead.website_kind; one
 *      search per lead lifetime unless those fields are cleared.
 */

import { env } from "../config";
import { getLogger } from "../logger";

const log = getLogger("social-search");

const CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const FETCH_TIMEOUT_MS = 6_000;

export interface SocialSearchInput {
  business_name: string;
  city?: string | null;
  country_code?: string | null;
}

export interface SocialSearchResult {
  url: string;
  kind: "facebook" | "instagram";
}

/** Build the `site:<platform> "<name>" <city> <country>` query. */
function buildQuery(platform: "facebook.com" | "instagram.com", input: SocialSearchInput): string {
  const nameQ = `"${input.business_name}"`;
  const ctxParts = [input.city, input.country_code?.toUpperCase()]
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  const ctx = ctxParts.join(" ");
  return `site:${platform} ${nameQ}${ctx ? " " + ctx : ""}`;
}

/**
 * One CSE query for one platform. Returns the first profile-shaped result
 * URL, or null. Soft-fails on any error.
 */
async function cseSearchSite(
  platform: "facebook.com" | "instagram.com",
  input: SocialSearchInput,
): Promise<string | null> {
  if (!env.GOOGLE_CSE_API_KEY || !env.GOOGLE_CSE_ID) {
    // Configured-but-empty is the "operator hasn't set up CSE yet" state.
    // Logged once per lead (info level) so it's visible in batch output.
    log.info({ platform }, "social_search.cse_not_configured");
    return null;
  }

  const q = buildQuery(platform, input);
  const url = new URL(CSE_ENDPOINT);
  url.searchParams.set("key", env.GOOGLE_CSE_API_KEY);
  url.searchParams.set("cx", env.GOOGLE_CSE_ID);
  url.searchParams.set("q", q);
  url.searchParams.set("num", "5"); // top 5 is plenty for picking a profile

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      // 429 = quota; 403 = key not authorized for Custom Search API.
      log.warn(
        { platform, status: resp.status, q },
        "social_search.cse_non_2xx",
      );
      return null;
    }
    const data = (await resp.json()) as {
      items?: Array<{ link?: string }>;
    };
    const links = (data.items ?? []).map((i) => i.link).filter((l): l is string => Boolean(l));
    for (const link of links) {
      if (!isOnPlatform(link, platform)) continue;
      if (!isProfileShapedUrl(link, platform)) continue;
      return link;
    }
    return null;
  } catch (err) {
    log.warn({ platform, err: String(err).slice(0, 200) }, "social_search.cse_failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isOnPlatform(url: string, platform: "facebook.com" | "instagram.com"): boolean {
  try {
    const u = new URL(url);
    return u.hostname === platform || u.hostname.endsWith("." + platform);
  } catch {
    return false;
  }
}

const FB_NON_PROFILE_PATHS = [
  "/login",
  "/recover",
  "/policies",
  "/help",
  "/business/help",
  "/policy",
  "/legal",
  "/watch",
  "/marketplace",
  "/groups",
  "/events",
  "/posts",
  "/photo",
  "/photos",
  "/video",
  "/sharer",
  "/dialog",
];
const IG_NON_PROFILE_PATHS = [
  "/accounts/login",
  "/accounts",
  "/explore",
  "/p/",
  "/reel/",
  "/reels/",
  "/stories/",
  "/about",
  "/directory",
  "/developer",
  "/legal",
  "/terms",
  "/privacy",
];

/**
 * Cheap heuristic for "this URL looks like a profile/page." Filters out
 * posts, events, login redirects, help pages.
 */
function isProfileShapedUrl(
  url: string,
  platform: "facebook.com" | "instagram.com",
): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (path === "/" || path === "") return false;

  const blocked = platform === "facebook.com" ? FB_NON_PROFILE_PATHS : IG_NON_PROFILE_PATHS;
  for (const prefix of blocked) {
    if (path.startsWith(prefix)) return false;
  }
  const segments = path.split("/").filter(Boolean);
  // FB /pages/<name>/<id> is profile-shaped.
  if (platform === "facebook.com" && segments[0] === "pages" && segments.length === 3) {
    return true;
  }
  if (segments.length > 2) return false;
  return segments.length >= 1;
}

export async function findSocialUrl(
  input: SocialSearchInput,
): Promise<SocialSearchResult | null> {
  const startMs = Date.now();
  const [fbUrl, igUrl] = await Promise.all([
    cseSearchSite("facebook.com", input),
    cseSearchSite("instagram.com", input),
  ]);
  const elapsedMs = Date.now() - startMs;

  if (fbUrl) {
    log.info({ business: input.business_name, url: fbUrl, elapsedMs }, "social_search.found.facebook");
    return { url: fbUrl, kind: "facebook" };
  }
  if (igUrl) {
    log.info({ business: input.business_name, url: igUrl, elapsedMs }, "social_search.found.instagram");
    return { url: igUrl, kind: "instagram" };
  }
  log.info({ business: input.business_name, elapsedMs }, "social_search.miss");
  return null;
}
