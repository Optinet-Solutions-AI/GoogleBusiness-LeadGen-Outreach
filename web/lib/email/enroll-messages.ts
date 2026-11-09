/**
 * email/enroll-messages.ts — plain-English text for why a lead can't join the email sequence. Pure.
 *
 * Inputs:  the reason code from enrollLeadInSequence (already_active | no_email | no_demo | suppressed | unverified)
 * Outputs: one sentence the operator can act on
 * Used by: app/api/leads/[id]/sequence/route.ts (shown by the Send outreach / Enroll buttons)
 */

const TEXT: Record<string, string> = {
  already_active: "This lead is already in the email sequence — the next email goes out on schedule.",
  no_email: "This lead has no email yet. Add one first.",
  no_demo: "Build the demo website first — the emails link to it.",
  suppressed: "This lead unsubscribed or is on the do-not-contact list, so it can't be emailed.",
  unverified:
    "This email isn't verified (only valid or catch-all addresses are emailed). Click Reverify on the lead, or fix the address.",
};

export function enrollRefusalText(reason: string | undefined): string {
  return (reason && TEXT[reason]) ?? `Can't start the email sequence (${reason ?? "unknown reason"}).`;
}
