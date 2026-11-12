/**
 * email/enroll-messages.ts — plain-English text for why a lead can't join the email sequence. Pure.
 *
 * Inputs:  the reason code from enrollLeadInSequence (already_active | no_email | no_demo | suppressed | unverified | copy_unsaved)
 * Outputs: one sentence the operator can act on
 * Used by: app/api/leads/[id]/sequence/route.ts (shown by the Send outreach / Enroll buttons)
 */

const TEXT: Record<string, string> = {
  already_active: "This lead is already in the email sequence — the next email goes out on schedule.",
  no_email: "This lead has no email yet. Add one first.",
  // Only campaign launches still require a demo; Send email (the preview) sends the no-demo version.
  no_demo: "Build the demo website first — the emails link to it.",
  suppressed: "This lead unsubscribed or is on the do-not-contact list, so it can't be emailed.",
  unverified:
    "This email failed verification (only valid or catch-all addresses are emailed). Fix or replace the address, then try again.",
  copy_unsaved:
    "Your edited wording can't be saved yet (database update 059 isn't applied). Nothing was sent. Undo your edits to send the standard wording, or apply the update first.",
};

export function enrollRefusalText(reason: string | undefined): string {
  return (reason && TEXT[reason]) ?? `Can't start the email sequence (${reason ?? "unknown reason"}).`;
}

/** What to tell the operator after a successful enroll, given the address's verification status. */
export function enrollToast(verification: string | null | undefined): { tone: "success" | "warning"; text: string } {
  if (verification === "valid" || verification === "catch-all")
    return { tone: "success", text: "Email sequence started — the first email goes out within about 15 minutes." };
  return {
    tone: "warning",
    text: "Sequence started, but the email checker couldn't confirm this address, so it's held until the address checks out. Fix the address if you can, then click Re-verify email.",
  };
}
