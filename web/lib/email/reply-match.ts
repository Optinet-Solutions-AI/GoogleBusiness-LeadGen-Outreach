/**
 * email/reply-match.ts — decide which lead an inbound reply belongs to when its sender's address is on several leads
 * (18 Nov 2026). Pure.
 *
 * Inputs:  the reply (subject, the mailbox it arrived in), the candidate lead ids that have the sender's address,
 *          and our outbound emails to that address ({lead_id, subject, account id, sent at})
 * Outputs: one lead id, or null when there is no candidate
 * Used by: lib/pipeline/inbox-sync.ts
 *
 * Why: Ongage replaces our Message-ID with its own, so a reply's In-Reply-To never points back at our email, and the
 * app fell back to "any lead with this address" — with one test inbox on 10 leads, replies landed on the wrong lead.
 * Order: the lead we sent this exact subject to (from this mailbox first) → the lead most recently emailed from this
 * mailbox → the lead most recently emailed at all → the first candidate.
 */

export interface OutboundRef {
  lead_id: string;
  subject: string | null;
  email_account_id: string | null;
  created_at: string;
}

/** "Re: RE: Fwd: Your website, Acme" → "your website, acme". */
export function baseSubject(subject: string | null | undefined): string {
  let s = (subject ?? "").trim();
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|antw)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").toLowerCase();
}

export function pickReplyLead(
  reply: { subject: string | null; accountId: string },
  candidates: string[],
  outbound: OutboundRef[],
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const allowed = new Set(candidates);
  const ours = outbound
    .filter((o) => allowed.has(o.lead_id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)); // newest first
  const subj = baseSubject(reply.subject);
  const sameBox = (o: OutboundRef) => o.email_account_id === reply.accountId;
  const sameSubject = (o: OutboundRef) => subj !== "" && baseSubject(o.subject) === subj;
  return (
    ours.find((o) => sameSubject(o) && sameBox(o))?.lead_id ??
    ours.find(sameSubject)?.lead_id ??
    ours.find(sameBox)?.lead_id ??
    ours[0]?.lead_id ??
    candidates[0]
  );
}
