/**
 * filters.ts — Lead qualification rules. Pure functions, no I/O.
 *
 * Inputs:  raw lead object from a scraper
 * Outputs: { passes: boolean, reason: string | null }
 * Used by: lib/pipeline/stage-1-scrape.ts before persisting a lead
 *
 * Rules (all must pass):
 *   - has_website == false (where "website" means a REAL website, not a
 *     Facebook/Yelp/Linktree page — see hasRealWebsite below)
 *   - rating >= MIN_RATING (3.0 — real businesses, not necessarily perfect)
 *   - review_count >= MIN_REVIEWS (3 — has SOME customer signal)
 *   - phone present (so the operator can follow up)
 *   - category contains target niche (substring match, case-insensitive)
 *
 * No upper bound on review_count — we target both small operators AND
 * larger established businesses without a real website.
 */

export const MIN_RATING = 3.0;
export const MIN_REVIEWS = 3;

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
}

export function qualifies(
  lead: RawLead,
  targetNiche?: string | null,
): { passes: boolean; reason: string | null } {
  if (lead.has_website) return { passes: false, reason: "has_website" };

  const rating = lead.rating ?? 0;
  if (rating < MIN_RATING) return { passes: false, reason: "low_rating" };

  const reviews = lead.review_count ?? 0;
  if (reviews < MIN_REVIEWS) return { passes: false, reason: "few_reviews" };

  if (!lead.phone) return { passes: false, reason: "no_phone" };

  if (targetNiche) {
    const cat = (lead.category ?? "").toLowerCase();
    if (!cat.includes(targetNiche.toLowerCase())) {
      return { passes: false, reason: "category_mismatch" };
    }
  }

  return { passes: true, reason: null };
}

/** Human-friendly labels for the rejection_reasons aggregate on the batch. */
export const REJECTION_REASON_LABEL: Record<string, string> = {
  has_website: "Already has a real website",
  low_rating: `Rating below ${MIN_RATING.toFixed(1)} stars`,
  few_reviews: `Fewer than ${MIN_REVIEWS} reviews`,
  no_phone: "No phone number",
  category_mismatch: "Category doesn't match niche",
};
