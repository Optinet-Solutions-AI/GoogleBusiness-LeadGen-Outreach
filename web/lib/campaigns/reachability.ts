/**
 * reachability.ts — pure "can we reach this lead on this channel?" logic.
 * Mirrors applyChannelEligibility (the DB-query version) for in-memory checks.
 *
 * Inputs:  a lead object with email/phone/website_kind fields + a Channel
 * Outputs: boolean (isReachable) or { eligible, skipped } partition
 * Used by: campaign engine (in-memory pre-filter before DB write)
 */
import { SOCIAL_KINDS, type Channel } from "./eligibility";

export interface ReachableLead {
  id: string;
  email: string | null;
  phone: string | null;
  website_kind: string | null;
}

export function isReachable(lead: ReachableLead, channel: Channel): boolean {
  switch (channel) {
    case "email":
      return !!lead.email;
    case "sms":
    case "voice_agent":
      return !!lead.phone;
    case "dm":
      return !!lead.website_kind && SOCIAL_KINDS.includes(lead.website_kind);
    default:
      return false;
  }
}

export function partitionForChannel<L extends ReachableLead>(
  leads: L[],
  channel: Channel,
): { eligible: L[]; skipped: { not_reachable: string[] } } {
  const eligible: L[] = [];
  const not_reachable: string[] = [];
  for (const l of leads) {
    if (isReachable(l, channel)) eligible.push(l);
    else not_reachable.push(l.id);
  }
  return { eligible, skipped: { not_reachable } };
}
