/**
 * scrapingbee.ts — Pull Google Knowledge Panel social profile URLs via
 * ScrapingBee's dedicated Google Search endpoint.
 *
 * Inputs:  business_name + optional city + optional country_code
 * Outputs: ordered list of { url, kind } candidates from the KP's
 *          social_profiles[] (Facebook + Instagram), [] on any failure
 * Used by: lib/services/social-search.ts as the last-chance discovery
 *          step (after DDG + slug-guess both miss).
 *
 * Why ScrapingBee specifically: the Google Places API returns at most one
 * `websiteUri` and never exposes the social profile URLs the business
 * owner registered in GMB. The Google Search Knowledge Panel DOES expose
 * those profiles (the "Profiles" row with FB/IG icons), but Google
 * bot-blocks our direct Playwright requests instantly (`/sorry/index`).
 * ScrapingBee runs a residential-proxy pool whose entire job is staying
 * unblocked on Google SERP scraping. They expose a dedicated Google
 * Search endpoint that returns the SERP as structured JSON, including
 * `knowledge_graph.social_profiles[]`.
 *
 * Cost: ~25 ScrapingBee credits per Google search. Free tier = 1k credits
 * (~40 searches/month). We call this ONLY when the cheap free paths have
 * failed, so credit burn is bounded by the no-website + DDG-miss tail —
 * historically 10-20% of leads.
 *
 * Soft-fails to [] on every error path (no API key configured, network
 * timeout, malformed JSON, missing knowledge_graph). Callers must not
 * treat the empty array as "no socials exist" — only as "ScrapingBee
 * didn't surface any this call."
 */

import { env } from "../config";
import { getLogger } from "../logger";

const log = getLogger("scrapingbee");

const ENDPOINT = "https://app.scrapingbee.com/api/v1/store/google";
const TIMEOUT_MS = 15_000;

export interface SocialCandidate {
  url: string;
  kind: "facebook" | "instagram";
  handle: string;
}

/**
 * Returns true when the ScrapingBee API key is configured. social-search
 * checks this before attempting the call so the empty-key case is a
 * cheap no-op rather than a wasted HTTP round-trip.
 */
export function isScrapingBeeEnabled(): boolean {
  return env.SCRAPINGBEE_API_KEY.length > 0;
}

/** Normalize a raw FB/IG URL to its page root (drops `/posts/`, query
 *  strings, trailing slashes, `/p/<id>`, `/reel/<id>` etc). Returns null
 *  when the URL isn't an FB/IG page or points at a system path. */
function normalizeSocialUrl(
  raw: string,
): { url: string; kind: "facebook" | "instagram"; handle: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  let kind: "facebook" | "instagram" | null = null;
  if (host === "facebook.com" || host === "m.facebook.com" || host === "fb.com") kind = "facebook";
  else if (host === "instagram.com") kind = "instagram";
  if (!kind) return null;

  const seg = url.pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
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
    return null;
  }
  const handle = seg.toLowerCase();
  return {
    url: `https://www.${kind === "facebook" ? "facebook" : "instagram"}.com/${handle}`,
    kind,
    handle,
  };
}

/** Pull FB/IG candidates out of two ScrapingBee response sections:
 *
 *  1. `knowledge_graph.profiles[]`   — Google's owner-registered KP icons.
 *                                       Field shape: { title, url }. KP often
 *                                       lists sister businesses (highest
 *                                       engagement) rather than this exact
 *                                       lead's account, so we don't trust
 *                                       it blindly — the caller's locality
 *                                       check rejects mismatches.
 *  2. `organic_results[].url`        — full SERP. Real Hamilton-NZ account
 *                                       lives here even when the KP returns
 *                                       a same-name Melbourne business.
 *
 *  Returned in KP-then-organic order; deduped by <kind>:<handle>. */
function extractFromResponse(payload: {
  knowledge_graph?: { profiles?: unknown; social_profiles?: unknown };
  organic_results?: unknown;
}): SocialCandidate[] {
  const out: SocialCandidate[] = [];
  const seen = new Set<string>();

  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const n = normalizeSocialUrl(raw);
    if (!n) return;
    const dedup = `${n.kind}:${n.handle}`;
    if (seen.has(dedup)) return;
    seen.add(dedup);
    out.push(n);
  };

  // KP profiles[]. ScrapingBee's docs evolved over time — be lenient about
  // the field name (profiles / social_profiles) and the URL key (url / link).
  const kpLists = [payload.knowledge_graph?.profiles, payload.knowledge_graph?.social_profiles];
  for (const list of kpLists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      push((entry as { url?: string; link?: string }).url ?? (entry as { link?: string }).link);
    }
  }

  // Organic results — same field-name leniency.
  if (Array.isArray(payload.organic_results)) {
    for (const r of payload.organic_results) {
      if (!r || typeof r !== "object") continue;
      push((r as { url?: string; link?: string }).url ?? (r as { link?: string }).link);
    }
  }

  return out;
}

/**
 * Query ScrapingBee's Google Search endpoint and return ordered FB/IG
 * candidates from the Knowledge Panel.
 */
export async function findKnowledgePanelSocials(
  businessName: string,
  city: string | null,
  countryCode: string | null,
): Promise<SocialCandidate[]> {
  if (!isScrapingBeeEnabled()) {
    log.debug({ business: businessName }, "scrapingbee.skipped.no_key");
    return [];
  }

  const startMs = Date.now();
  const query = [businessName, city].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    api_key: env.SCRAPINGBEE_API_KEY,
    search: query,
    language: "en",
    nb_results: "10",
  });
  if (countryCode) params.set("country_code", countryCode.toLowerCase());

  const url = `${ENDPOINT}?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const cost = res.headers.get("Spb-cost") ?? res.headers.get("spb-cost");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(
        { query, status: res.status, body: body.slice(0, 200), cost },
        "scrapingbee.bad_status",
      );
      return [];
    }
    const payload = (await res.json()) as {
      knowledge_graph?: { profiles?: unknown; social_profiles?: unknown };
      organic_results?: unknown;
    };
    const socials = extractFromResponse(payload);
    log.info(
      {
        query,
        country: countryCode,
        candidates: socials.length,
        cost,
        elapsedMs: Date.now() - startMs,
      },
      "scrapingbee.kp_socials",
    );
    return socials;
  } catch (err) {
    log.warn(
      { query, err: String(err).slice(0, 200), elapsedMs: Date.now() - startMs },
      "scrapingbee.failed",
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}
