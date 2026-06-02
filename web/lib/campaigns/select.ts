/**
 * campaigns/select.ts — Pick the leads a campaign snapshots. Pure, no I/O.
 *
 * Inputs:  candidate leads (already filtered by segment/country/category in the query) + target count
 * Outputs: ordered lead ids (newest first, suppressed excluded, capped at target)
 * Used by: app/api/campaigns/route.ts (app-source snapshot)
 */

const SUPPRESSED = new Set(["dnc", "unsubscribed"]);

export interface Candidate {
  id: string;
  created_at: string;
  lifecycle_stage?: string | null;
}

export function selectSnapshot(candidates: Candidate[], targetCount: number): string[] {
  if (targetCount <= 0) return [];
  return candidates
    .filter((c) => !SUPPRESSED.has(c.lifecycle_stage ?? ""))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, targetCount)
    .map((c) => c.id);
}
