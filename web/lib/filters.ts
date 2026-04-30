/**
 * filters.ts — Lead qualification rules. Pure functions, no I/O.
 *
 * Inputs:  raw lead object from a scraper
 * Outputs: { passes: boolean, reason: string | null, detail?: string }
 * Used by: lib/pipeline/stage-1-scrape.ts before persisting a lead
 *
 * Rules (all must pass):
 *   - has_website == false (where "website" means a REAL website, not a
 *     Facebook/Yelp/Linktree page — see hasRealWebsite below)
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
 * larger established businesses without a real website.
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

/**
 * Hosts that show up in Google's `websiteUri` field but DON'T count as a
 * real website for our purposes. A business listed on these alone still
 * needs a real website built for them, so we treat them as `has_website=false`.
 *
 * Order matters: longer/more-specific entries first (we substring-match).
 */
const NOT_REAL_WEBSITE_HOSTS = [
  // social platforms
  "facebook.com",
  "fb.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "tiktok.com",
  "pinterest.com",
  "youtube.com",
  // listing/aggregator platforms
  "yelp.com",
  "yellowpages.com",
  "foursquare.com",
  "nextdoor.com",
  "thumbtack.com",
  "angi.com",
  "angieslist.com",
  "homeadvisor.com",
  "bbb.org",
  // link-aggregator services (one-page profiles)
  "linktr.ee",
  "beacons.ai",
  "about.me",
  "carrd.co",
  // free site-builder placeholder hosts
  "sites.google.com",
  "google.com/maps",
  "wix.com/home",
  "wixsite.com", // free-tier wix subdomain
  "weebly.com",
  "webnode.com",
  "blogspot.com",
  "wordpress.com",
];

/**
 * Returns true ONLY if the URL points at a real, owned website.
 * `null` / blank → false (no website at all)
 * Social/listing/aggregator URL → false (we treat these as "no real site")
 * `https://joesplumbing.com` → true
 */
export function hasRealWebsite(url: string | null | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }
  return !NOT_REAL_WEBSITE_HOSTS.some((s) => host === s || host.endsWith("." + s));
}

export interface RawLead {
  has_website?: boolean;
  rating?: number | null;
  review_count?: number | null;
  phone?: string | null;
  category?: string | null;
  business_name?: string | null;
}

export interface QualifyResult {
  passes: boolean;
  reason: string | null;
  /** Optional human-readable extra context (e.g. "got: store"). */
  detail?: string;
}

/** Tokenize a niche into matchable keywords (≥3 chars, no filler). */
function nicheTokens(niche: string): string[] {
  return niche
    .toLowerCase()
    .split(/[\s,/-]+/)
    .filter((t) => t.length >= 3 && !FILLER_WORDS.has(t));
}

export function qualifies(lead: RawLead, targetNiche?: string | null): QualifyResult {
  if (lead.has_website) return { passes: false, reason: "has_website" };

  const rating = lead.rating ?? 0;
  if (rating < MIN_RATING) {
    return { passes: false, reason: "low_rating", detail: `${rating.toFixed(1)}★` };
  }

  const reviews = lead.review_count ?? 0;
  if (reviews < MIN_REVIEWS) {
    return { passes: false, reason: "few_reviews", detail: `${reviews} reviews` };
  }

  if (!lead.phone) return { passes: false, reason: "no_phone" };

  if (targetNiche) {
    const tokens = nicheTokens(targetNiche);
    if (tokens.length > 0) {
      const haystack = [lead.category ?? "", lead.business_name ?? ""]
        .join(" ")
        .toLowerCase();
      const matches = tokens.some((t) => haystack.includes(t));
      if (!matches) {
        return {
          passes: false,
          reason: "category_mismatch",
          detail: lead.category ? `got: ${lead.category}` : "no category",
        };
      }
    }
    // If after stripping filler words there's nothing left to match
    // (e.g. niche = "personal company"), skip the relevance check.
  }

  return { passes: true, reason: null };
}

/** Human-friendly labels for the rejection_reasons aggregate on the batch. */
export const REJECTION_REASON_LABEL: Record<string, string> = {
  has_website: "Already has a real website",
  low_rating: `Rating below ${MIN_RATING.toFixed(1)} stars`,
  few_reviews: `Fewer than ${MIN_REVIEWS} reviews`,
  no_phone: "No phone number",
  category_mismatch: "Doesn't look like the niche you searched",
};
