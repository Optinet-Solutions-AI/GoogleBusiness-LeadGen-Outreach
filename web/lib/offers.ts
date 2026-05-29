/**
 * offers.ts — Route a lead to the best-fit outreach offer. Pure, no I/O.
 *
 * Inputs:  lead signals { has_website, needs_improvement }
 * Outputs: { qualifies, primary_offer, secondary_offer, reason }
 * Used by: lib/pipeline/stage-1-scrape.ts (enrichOne), stage-2-enrich.ts
 *
 * The three offers we sell:
 *   - build_website   : the business has no real website
 *   - improve_website : the business has a real but old/broken website
 *   - voice_agent     : AI phone receptionist — the universal *secondary*
 *                       (attach) offer on every kept lead
 *
 * Funnel rule (operator decision): keep no-website AND old-website leads;
 * drop businesses whose real website is healthy (nothing to build/improve,
 * so not worth a cold call for the website angle).
 */

export const OFFERS = ["build_website", "improve_website", "voice_agent"] as const;
export type Offer = (typeof OFFERS)[number];

/** Human labels for the dashboard badge + call scripts. */
export const OFFER_LABEL: Record<Offer, string> = {
  build_website: "Build website",
  improve_website: "Improve website",
  voice_agent: "Voice agent",
};

export interface OfferSignals {
  /** A REAL owned website (filters.hasRealWebsite). Social/listing pages are false. */
  has_website: boolean;
  /** Auditor verdict — only meaningful when has_website is true. null = not audited. */
  needs_improvement?: boolean | null;
}

export interface OfferRoute {
  /** false → drop (healthy site, no website angle to pitch). */
  qualifies: boolean;
  primary_offer: Offer | null;
  secondary_offer: Offer | null;
  /** Rejection reason when !qualifies (e.g. 'good_website'); null otherwise. */
  reason: string | null;
}

/**
 * Decide which offer to pitch a lead.
 *
 *   no real website                 → build_website   (+ voice_agent attach)
 *   real website + needs_improvement → improve_website (+ voice_agent attach)
 *   real website + healthy           → DROP ('good_website')
 */
export function routeOffer(signals: OfferSignals): OfferRoute {
  if (!signals.has_website) {
    return {
      qualifies: true,
      primary_offer: "build_website",
      secondary_offer: "voice_agent",
      reason: null,
    };
  }

  // Has a real website — the audit decides build/improve vs drop.
  if (signals.needs_improvement) {
    return {
      qualifies: true,
      primary_offer: "improve_website",
      secondary_offer: "voice_agent",
      reason: null,
    };
  }

  // Healthy real website — nothing to build or improve. Drop.
  return {
    qualifies: false,
    primary_offer: null,
    secondary_offer: null,
    reason: "good_website",
  };
}
