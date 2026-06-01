/**
 * segment.ts — Derive the call SEGMENT for a lead. Pure, no I/O.
 *
 * Inputs:  { has_website, needs_improvement } (audit signals)
 * Outputs: CallSegment — drives which campaign/script a lead belongs to
 * Used by: lib/offers.ts (routeOffer), lib/leads/import.ts
 *
 * Three segments (see docs/superpowers/specs/2026-06-01-campaign-based-calling-design.md):
 *   no_website   — no real website        → build pitch
 *   old_website  — real but needs work    → improve pitch
 *   has_website  — real + healthy         → discovery/menu pitch (kept, not dropped)
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
