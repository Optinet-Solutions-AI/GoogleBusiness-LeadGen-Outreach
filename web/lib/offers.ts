/**
 * offers.ts — Route a lead to the best-fit outreach offer. Pure, no I/O.
 *
 * Inputs:  lead signals { has_website, needs_improvement }
 * Outputs: { qualifies, primary_offer, secondary_offer, segment, reason }
 * Used by: lib/pipeline/stage-1-scrape.ts (enrichOne), stage-2-enrich.ts
 *
 * The three offers we sell:
 *   - build_website   : the business has no real website
 *   - improve_website : the business has a real but old/broken website
 *   - voice_agent     : AI phone receptionist — the universal *secondary*
 *                       (attach) offer on every kept lead
 *
 * Funnel rule (3-segment model): ALL leads are kept and callable.
 *   no_website  → build pitch    old_website → improve pitch
 *   has_website → discovery/menu call (no single offer)
 */

import { deriveSegment, type CallSegment } from "./segment";

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
  /** Always true now — all three segments are worth a call. Kept for callers. */
  qualifies: boolean;
  /** null for has_website (the discovery/menu call pitches no single offer). */
  primary_offer: Offer | null;
  secondary_offer: Offer | null;
  /** Which segment/script this lead belongs to. */
  segment: CallSegment;
  /** Reserved for future hard-drops; null in the 3-segment model. */
  reason: string | null;
}

/** Segment → offer pair. Single source of truth for both the auto-router and
 *  the manual-override PATCH route. */
export function offersForSegment(segment: CallSegment): {
  primary_offer: Offer | null;
  secondary_offer: Offer | null;
} {
  switch (segment) {
    case "no_website": return { primary_offer: "build_website", secondary_offer: "voice_agent" };
    case "old_website": return { primary_offer: "improve_website", secondary_offer: "voice_agent" };
    case "has_website": return { primary_offer: null, secondary_offer: "voice_agent" };
  }
}

/**
 * Route a lead to its segment + offers.
 *   no real website                 → build_website   (+ voice_agent attach)
 *   real website + needs_improvement → improve_website (+ voice_agent attach)
 *   real website + healthy           → KEEP for the discovery/menu call (primary null)
 */
export function routeOffer(signals: OfferSignals): OfferRoute {
  const segment = deriveSegment(signals);
  const { primary_offer, secondary_offer } = offersForSegment(segment);
  return { qualifies: true, primary_offer, secondary_offer, segment, reason: null };
}
