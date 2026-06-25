/**
 * sender-rotation.ts — Choose which mailbox sends a lead's FIRST email. Pure.
 *
 * Inputs:  a pool of mailboxes with remaining daily capacity + a lead id
 * Outputs: the chosen mailbox email (deterministic per lead), or null if none
 *          has capacity
 * Used by: lib/pipeline/sequence-scheduler.ts (first-send sender assignment)
 *
 * Deterministic so a scheduler re-run picks the same mailbox for the same lead.
 * Only mailboxes with remaining > 0 are eligible; the lead id is hashed to an
 * index into the eligible list so different leads spread across the pool while
 * each lead is stable. Once chosen, the caller pins it to seq_sender_email and
 * never re-rotates (follow-ups reuse the pinned mailbox).
 */

export interface SenderSlot {
  email: string;
  remaining: number;
}

/** FNV-1a — tiny, dependency-free, stable hash of the lead id. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function pickSender(pool: SenderSlot[], leadId: string): string | null {
  const eligible = pool.filter((s) => s.remaining > 0);
  if (eligible.length === 0) return null;
  // Stable order so the index mapping doesn't depend on input ordering.
  eligible.sort((a, b) => a.email.localeCompare(b.email));
  return eligible[hash(leadId) % eligible.length].email;
}
