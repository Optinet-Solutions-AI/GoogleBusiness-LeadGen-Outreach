/**
 * verify/email-change.ts — when a lead's email address changes, the old address's check result must go with it.
 *
 * Inputs:  the lead's current email and the new one
 * Outputs: the verification columns to clear (or {} when the address didn't really change)
 * Used by: app/api/leads/[id]/route.ts (PATCH — the Contact card's email edit)
 *
 * Pure. Without this, editing an email kept the previous address's "valid" verdict, so the new (unchecked)
 * address was treated as already checked and emailed straight away (found 15 Nov 2026: a made-up test address
 * was sent to). Cleared → the next send checks the new address first.
 */

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function verificationResetFor(currentEmail: string | null | undefined, nextEmail: string | null | undefined): Record<string, unknown> {
  if (sameEmail(currentEmail, nextEmail)) return {};
  return {
    verification_status: null,
    email_verified: false,
    verified_at: null,
    verify_syntax_ok: null,
    verify_mx_ok: null,
    verify_smtp_result: null,
    verify_zerobounce_result: null,
    verify_millionverifier_result: null,
    verify_hunter_result: null,
  };
}
