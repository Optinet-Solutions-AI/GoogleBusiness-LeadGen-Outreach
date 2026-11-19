/**
 * email/optirate-sender.ts — the default sender for reputation-management emails: an OptiRate mailbox (19 Nov 2026).
 *
 * Inputs:  the active mailboxes with how many emails each sent today and its warm-up cap
 * Outputs: the OptiRate address (domain contains "optirate") with the most of today's allowance left; ties go to the
 *          alphabetically first address (ethan@ before lily@); null when no OptiRate mailbox is connected. Pure.
 * Used by: lib/email/compose-context.ts (Send email window, review-site leads)
 */

export function pickOptiRateSender(boxes: { email: string; sentToday: number; cap: number }[]): string | null {
  const optirate = boxes.filter((b) => (b.email.split("@")[1] ?? "").toLowerCase().includes("optirate"));
  if (optirate.length === 0) return null;
  const sorted = [...optirate].sort((a, b) => b.cap - b.sentToday - (a.cap - a.sentToday) || a.email.localeCompare(b.email));
  return sorted[0].email;
}
