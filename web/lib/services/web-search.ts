/**
 * web-search.ts — Find candidate social URLs for a business via a public
 * search engine (DuckDuckGo's no-JS HTML endpoint).
 *
 * Inputs:  business_name + optional city
 * Outputs: ordered list of { url, kind } candidates (FB / IG) extracted
 *          from the SERP, deduplicated to the *page* URL (not post URLs)
 * Used by: lib/services/social-search.ts as the primary discovery step
 *
 * Why this exists: Google Places' websiteUri field returns at most ONE URL
 * per business, and the URL is often stale (Facebook recycles vanity
 * handles, owners change linked profiles). The Google Maps panel
 * sometimes shows multiple social profiles in a "Profiles" widget, but
 * the Maps frontend is bot-protected from automation (we get
 * `/sorry/index` immediately). DDG's HTML endpoint doesn't bot-block
 * residential traffic and the business's real FB/IG pages reliably rank
 * in the top organic results for a "<name> <city>" query.
 *
 * Caller validates each candidate's locality (bio mentions the lead's
 * city or country) before persisting — this module only surfaces
 * candidates, it doesn't validate them.
 *
 * Wall time: ~1-2s per call. No API key, no quota. We do not pre-warm or
 * cache; stage-2 only hits this once per lead.
 */

import { getLogger } from "../logger";

const log = getLogger("web-search");

const DDG_URL = "https://html.duckduckgo.com/html/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT_MS = 7_000;

export interface SocialCandidate {
  url: string;
  kind: "facebook" | "instagram";
  handle: string;
}

/**
 * Extract `https://www.facebook.com/<handle>` and `instagram.com/<handle>`
 * URLs from a DDG HTML SERP, normalized to the PAGE root (drops `/posts/`,
 * `/p/`, query strings, etc.).
 *
 * DDG wraps every external link in a redirect:
 *   //duckduckgo.com/l/?uddg=<urlencoded>&rut=<hash>
 * We decode the `uddg` param to get the real URL.
 *
 * Returns candidates in the order they appeared in the SERP, deduped by
 * <kind>:<handle>. Useful because relevance ordering puts the most-likely
 * canonical page first.
 */
function extractCandidatesFromHtml(html: string): SocialCandidate[] {
  const out: SocialCandidate[] = [];
  const seen = new Set<string>();

  const re = /href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)/g;
  for (const m of html.matchAll(re)) {
    const raw = decodeURIComponent(m[1]);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^www\./, "");
    let kind: "facebook" | "instagram" | null = null;
    if (host === "facebook.com" || host === "m.facebook.com") kind = "facebook";
    else if (host === "instagram.com") kind = "instagram";
    if (!kind) continue;

    // Strip post/reel/profile-subpage paths — we only want the page root.
    // FB page handles: /<handle> (optionally /posts, /photos, etc. — drop)
    // IG handles:      /<handle> (optionally /p/<id>, /reel/<id> — drop)
    const seg = url.pathname.split("/").filter(Boolean)[0];
    if (!seg) continue;
    // Skip Facebook system paths and Instagram non-profile paths.
    if (
      seg === "people" ||
      seg === "profile.php" ||
      seg === "groups" ||
      seg === "events" ||
      seg === "pages" ||
      seg === "p" ||
      seg === "reel" ||
      seg === "stories" ||
      seg === "explore" ||
      seg === "accounts"
    ) {
      continue;
    }

    const handle = seg.toLowerCase();
    const dedup = `${kind}:${handle}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const normalized = `https://www.${kind === "facebook" ? "facebook" : "instagram"}.com/${handle}`;
    out.push({ url: normalized, kind, handle });
  }
  return out;
}

/**
 * Run a DDG search for `<business_name> <city>` and return ordered
 * FB / IG page candidates. Soft-fails to [] on any error — caller falls
 * through to slug-guess.
 */
export async function findSocialCandidates(
  businessName: string,
  city: string | null,
): Promise<SocialCandidate[]> {
  const startMs = Date.now();
  const q = [businessName, city].filter(Boolean).join(" ");
  const url = `${DDG_URL}?q=${encodeURIComponent(q)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      log.warn({ q, status: res.status }, "web_search.bad_status");
      return [];
    }
    const html = await res.text();
    const candidates = extractCandidatesFromHtml(html);
    log.info(
      { q, count: candidates.length, elapsedMs: Date.now() - startMs },
      "web_search.candidates",
    );
    return candidates;
  } catch (err) {
    log.warn({ q, err: String(err).slice(0, 200) }, "web_search.failed");
    return [];
  } finally {
    clearTimeout(timer);
  }
}
