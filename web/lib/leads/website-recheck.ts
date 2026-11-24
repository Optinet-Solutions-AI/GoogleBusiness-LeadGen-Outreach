/**
 * website-recheck.ts — "Check website again" rules. Pure (no network, no DB).
 *
 * Inputs:  the lead (website, signal type, last check) / a finished WebsiteReview
 * Outputs: the plain reason it's refused (or null) · the lead update a finished check makes
 * Used by: lib/leads/website-recheck-run.ts, app/api/leads/[id]/website-review/route.ts
 *
 * The check replaces John's manual Good / Old / No website dropdown (25 Nov 2026): the AI's verdict decides the
 * pitch, and a re-check also hands routing back from any old manual choice (offer_locked off).
 */
import { routeOffer } from "@/lib/offers";
import { reviewFields, type WebsiteReview } from "./website-review";

/** A check normally takes under a minute; one older than this is treated as stuck and may be restarted. */
export const RECHECK_WAIT_MS = 3 * 60_000;

export type RecheckLead = {
  website_url: string | null;
  signal_type: string | null;
  website_review: { pending_at?: string | null } | null;
};

export function recheckRefusal(lead: RecheckLead, now: Date): string | null {
  if (lead.signal_type) return "This lead is never pitched a website, so its website isn't checked.";
  if (!lead.website_url) return "This lead has no website to check.";
  const pendingAt = lead.website_review?.pending_at ? Date.parse(lead.website_review.pending_at) : NaN;
  if (Number.isFinite(pendingAt) && now.getTime() - pendingAt < RECHECK_WAIT_MS) {
    return "Already checking their website. It takes about a minute.";
  }
  return null;
}

/** The lead update a finished check makes: the verdict, the pitch it leads to, and the review itself. */
export function recheckPatch(review: WebsiteReview) {
  const fields = reviewFields(review);
  const route = routeOffer({ has_website: fields.has_website, needs_improvement: fields.needs_improvement, signal_type: null });
  return {
    ...fields,
    call_segment: route.segment,
    primary_offer: route.primary_offer,
    secondary_offer: route.secondary_offer,
    offer_locked: false,
    website_review: review,
    website_reviewed_at: review.checked_at,
  };
}
