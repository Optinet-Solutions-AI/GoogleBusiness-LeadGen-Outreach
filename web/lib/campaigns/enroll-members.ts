/**
 * enroll-members.ts — Decide which campaign members to enroll in the sequence.
 *
 * Inputs:  member leads { id, email, seq_status }
 * Outputs: ids of leads that have an email and aren't already in an active ladder
 * Used by: app/api/campaigns/route.ts (email-campaign create)
 */
export function enrollableMemberIds(
  members: { id: string; email: string | null; seq_status: string | null }[],
): string[] {
  return members
    .filter((m) => !!m.email && m.seq_status !== "active")
    .map((m) => m.id);
}
