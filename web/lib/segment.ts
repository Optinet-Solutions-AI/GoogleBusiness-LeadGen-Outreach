/**
 * segment.ts — Derive the call SEGMENT for a lead. Pure, no I/O.
 *
 * Inputs:  { has_website, needs_improvement } (audit signals)
 * Outputs: CallSegment — drives which campaign/script a lead belongs to
 * Used by: lib/offers.ts (routeOffer), lib/leads/import.ts
 *
 * Three segments (see docs/superpowers/specs/2026-06-01-campaign-based-calling-design.md):
 *   no_website   — no real website        → BUILD a website
 *   old_website  — real but needs work    → IMPROVE the website
 *   has_website  — real + healthy         → AI SERVICES (booking / receptionist /
 *                                           chat), NOT a website. Their site is fine.
 *                                           (legacy voice_agent offer is parked.)
 */

export const CALL_SEGMENTS = ["no_website", "old_website", "has_website"] as const;
export type CallSegment = (typeof CALL_SEGMENTS)[number];

export interface SegmentSignals {
  /** A REAL owned website (not a social/listing page). */
  has_website: boolean;
  /** Auditor verdict; only meaningful when has_website. null = not audited. */
  needs_improvement?: boolean | null;
}

export function deriveSegment(signals: SegmentSignals): CallSegment {
  if (!signals.has_website) return "no_website";
  // null/undefined audit → treat as healthy (don't pitch "improve" on an unaudited site).
  return signals.needs_improvement === true ? "old_website" : "has_website";
}

export interface SegmentLead {
  /** Operator override; wins when set to a valid segment. */
  call_segment?: string | null;
  /** "real" = a real owned website (vs social/listing/none). */
  website_kind?: string | null;
  /** Explicit has_website if the caller has it; else derived from website_kind. */
  has_website?: boolean | null;
  /** Auditor verdict; only meaningful when has_website. null = not audited. */
  needs_improvement?: boolean | null;
}

/**
 * THE canonical segment for a lead — use this everywhere (UI badges, lead page,
 * the email scheduler) so every surface agrees. Prefers the operator-set
 * call_segment, else derives from the website signals. Never returns null.
 *
 * Centralizing this is the whole point: a healthy-site lead with an unset
 * call_segment must resolve to has_website on BOTH the dashboard and the server
 * scheduler, or the two disagree (UI offers AI services, server sends build copy).
 */
export function resolveSegment(lead: SegmentLead): CallSegment {
  if (lead.call_segment && (CALL_SEGMENTS as readonly string[]).includes(lead.call_segment)) {
    return lead.call_segment as CallSegment;
  }
  const hasWebsite = lead.has_website ?? lead.website_kind === "real";
  return deriveSegment({ has_website: !!hasWebsite, needs_improvement: lead.needs_improvement ?? null });
}
