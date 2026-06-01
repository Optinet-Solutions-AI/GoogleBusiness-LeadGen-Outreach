/**
 * filters.ts — Lead qualification rules. Pure functions, no I/O.
 *
 * Inputs:  raw lead object from a scraper
 * Outputs: { passes: boolean, reason: string | null, detail?: string }
 * Used by: lib/pipeline/stage-1-scrape.ts before persisting a lead
 *
 * Rules (all must pass):
 *   - rating >= MIN_RATING (3.0 — real businesses, not necessarily perfect)
 *   - review_count >= MIN_REVIEWS (3 — has SOME customer signal)
 *   - phone present (so the operator can follow up)
 *   - niche relevance check: at least ONE niche keyword (≥3 chars, after
 *     stripping filler words like "company"/"service"/"mobile") must
 *     appear somewhere in either Google's category string OR the
 *     business name. Far more lenient than the previous full-substring
 *     rule, which was rejecting valid leads because Google's category
 *     codes ("store", "point_of_interest") never contain phrases like
 *     "estate sale company".
 *
 * No upper bound on review_count — we target both small operators AND
 * larger established businesses.
 *
 * NOTE on websites: this qualifier NO LONGER rejects leads that already have
 * a real website. The funnel keeps all three segments — no-website (→ build_website),
 * old-website (→ improve_website), and healthy-website (→ has_website, the
 * discovery/menu call). See lib/offers.ts (routeOffer) + lib/segment.ts.
 */

export const MIN_RATING = 3.0;
export const MIN_REVIEWS = 3;

/**
 * Words we drop from the niche before matching. They're either too
 * generic (company, service) or describe HOW the business operates
 * rather than WHAT they do (mobile, independent, personal,
 * professional). Including them in the match would either over-reject
 * (almost no Google category contains "company") or always pass
 * (every business has "service" in its description).
 */
const FILLER_WORDS = new Set([
  "company", "companies", "service", "services",
  "for", "hire", "the", "and", "in", "a", "of", "to", "with",
  "independent", "mobile", "personal", "professional",
]);

import type { WebsiteKind } from "./services/types";

/**
 * Each entry maps a (sub)host pattern to the WebsiteKind enum value.
 * If a hostname matches none of these, the URL is classified as 'real'.
 * Order matters: more-specific patterns FIRST (we walk top-down).
 */
const HOST_TO_KIND: Array<{ host: string; kind: WebsiteKind }> = [
  // social platforms
  { host: "facebook.com", kind: "facebook" },
  { host: "fb.com", kind: "facebook" },
  { host: "instagram.com", kind: "instagram" },
  { host: "twitter.com", kind: "twitter" },
  { host: "x.com", kind: "twitter" },
  { host: "linkedin.com", kind: "linkedin" },
  { host: "tiktok.com", kind: "tiktok" },
  { host: "pinterest.com", kind: "pinterest" },
  { host: "youtube.com", kind: "youtube" },
  // listing / aggregator platforms
  { host: "yelp.com", kind: "yelp" },
  { host: "yellowpages.com", kind: "yellowpages" },
  { host: "foursquare.com", kind: "foursquare" },
  { host: "nextdoor.com", kind: "nextdoor" },
  { host: "thumbtack.com", kind: "thumbtack" },
  { host: "angi.com", kind: "angi" },
  { host: "angieslist.com", kind: "angi" },
  { host: "homeadvisor.com", kind: "other_aggregator" },
  { host: "bbb.org", kind: "bbb" },
  // link-aggregator one-pagers
  { host: "linktr.ee", kind: "linktree" },
  { host: "beacons.ai", kind: "beacons" },
  { host: "about.me", kind: "about_me" },
  { host: "carrd.co", kind: "carrd" },
  // free site-builder placeholder hosts
  { host: "sites.google.com", kind: "sites_google" },
  { host: "google.com/maps", kind: "other_aggregator" },
  { host: "wix.com/home", kind: "wix_free" },
  { host: "wixsite.com", kind: "wix_free" }, // free-tier subdomain
  { host: "weebly.com", kind: "weebly" },
  { host: "webnode.com", kind: "webnode" },
  { host: "blogspot.com", kind: "blogspot" },
  { host: "wordpress.com", kind: "wordpress" },
];

/** Set of kinds that mean "not a real owned website" — used by hasRealWebsite. */
const NOT_REAL_KINDS: ReadonlySet<WebsiteKind> = new Set([
  "facebook", "instagram", "twitter", "linkedin", "tiktok", "pinterest", "youtube",
  "yelp", "yellowpages", "foursquare", "nextdoor", "thumbtack", "angi", "bbb",
  "linktree", "beacons", "about_me", "carrd",
  "sites_google", "wix_free", "weebly", "webnode", "blogspot", "wordpress",
  "other_social", "other_aggregator", "other_free_host",
]);

/**
 * Classify a URL into a WebsiteKind.
 * - null/blank → 'none'
 * - unparseable → 'none'
 * - matches a known social/aggregator/free-host → that platform's kind
 * - otherwise → 'real' (an owned domain)
 */
export function classifyWebsite(url: string | null | undefined): WebsiteKind {
  if (!url) return "none";
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "none";
  }
  for (const { host: pattern, kind } of HOST_TO_KIND) {
    if (host === pattern || host.endsWith("." + pattern)) return kind;
  }
  return "real";
}

/**
 * Returns true ONLY if the URL points at a real, owned website.
 * `null` / blank → false (no website at all)
 * Social/listing/aggregator URL → false (we treat these as "no real site")
 * `https://joesplumbing.com` → true
 */
export function hasRealWebsite(url: string | null | undefined): boolean {
  const kind = classifyWebsite(url);
  if (kind === "none") return false;
  return !NOT_REAL_KINDS.has(kind);
}

export interface RawLead {
  has_website?: boolean;
  rating?: number | null;
  review_count?: number | null;
  phone?: string | null;
  category?: string | null;
  business_name?: string | null;
  /**
   * Google's businessStatus. CLOSED_PERMANENTLY is a hard-reject (the small,
   * obvious dead-end). CLOSED_TEMPORARILY is intentionally NOT rejected — it
   * stays a flag so the operator can decide.
   */
  business_status?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
}

export interface QualifyResult {
  passes: boolean;
  reason: string | null;
  /** Optional human-readable extra context (e.g. "got: store"). */
  detail?: string;
  /** True when Google's category/name didn't contain a niche keyword. NOT a
   *  rejection — the lead still passes; this is a soft flag for the operator
   *  (Google already ranked it relevant to the search). */
  category_off_niche?: boolean;
}

/** Tokenize a niche into matchable keywords (≥3 chars, no filler). */
function nicheTokens(niche: string): string[] {
  return niche
    .toLowerCase()
    .split(/[\s,/-]+/)
    .filter((t) => t.length >= 3 && !FILLER_WORDS.has(t));
}

export function qualifies(lead: RawLead, targetNiche?: string | null): QualifyResult {
  // has_website is intentionally NOT a reject here — website-having leads are
  // kept and routed downstream (audit → improve_website, or drop if healthy).

  // Small/obvious dead-end: Google has explicitly marked this listing as
  // permanently closed. CLOSED_TEMPORARILY is NOT rejected — operator
  // decides per the detect-don't-auto-reject policy.
  if (lead.business_status === "CLOSED_PERMANENTLY") {
    return { passes: false, reason: "closed_permanently" };
  }

  const rating = lead.rating ?? 0;
  if (rating < MIN_RATING) {
    return { passes: false, reason: "low_rating", detail: `${rating.toFixed(1)}★` };
  }

  const reviews = lead.review_count ?? 0;
  if (reviews < MIN_REVIEWS) {
    return { passes: false, reason: "few_reviews", detail: `${reviews} reviews` };
  }

  if (!lead.phone) return { passes: false, reason: "no_phone" };

  // Category relevance is a SOFT FLAG, not a reject. Google already ranked
  // these results for the niche query — second-guessing it with a literal
  // keyword match was cutting clearly-relevant leads (e.g. "personal trainer"
  // → token "trainer", which "gym"/"fitness_center"/"wellness_center" don't
  // contain). We keep the lead qualified and flag it for the operator to
  // eyeball. (Detect, don't reject.)
  let categoryOffNiche = false;
  if (targetNiche) {
    const tokens = nicheTokens(targetNiche);
    if (tokens.length > 0) {
      const haystack = [lead.category ?? "", lead.business_name ?? ""]
        .join(" ")
        .toLowerCase();
      categoryOffNiche = !tokens.some((t) => haystack.includes(t));
    }
    // If after stripping filler words there's nothing left to match
    // (e.g. niche = "personal company"), the flag stays false.
  }

  return { passes: true, reason: null, category_off_niche: categoryOffNiche };
}

/** Human-friendly labels for the rejection_reasons aggregate on the batch. */
export const REJECTION_REASON_LABEL: Record<string, string> = {
  // 'has_website' kept for legacy rows scraped before the audit/offer split.
  has_website: "Already has a real website",
  good_website: "Has a healthy modern website (no build/improve angle)", // legacy only — not emitted by current pipeline (leads are kept as has_website, not rejected)
  closed_permanently: "Permanently closed (per Google)",
  low_rating: `Rating below ${MIN_RATING.toFixed(1)} stars`,
  few_reviews: `Fewer than ${MIN_REVIEWS} reviews`,
  no_phone: "No phone number",
  category_mismatch: "Doesn't look like the niche you searched",
};
