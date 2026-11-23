/**
 * leads/email-reach.ts — which AI Lookup emails reach the business itself, and which reach its head office or an agency.
 *
 * Inputs:  an AI Lookup result: emails, who each one reaches (email_notes) and, since 23 Nov 2026, whose inbox it is
 *          (email_scope: own / head_office / agency)
 * Outputs: isOwnEmail(email, profile) · firstOwnEmail(profile) · notOwnEmails(profile)
 * Used by: lib/pipeline/batch-ai-lookup.ts (scraping), lib/leads/ai-profile.ts (AI Lookup button)
 *
 * Operator decision (23 Nov 2026, after QA found franchise@popalock.com on Pop-A-Lock Mobile and marketing@rrsc.com on
 * Roto-Rooter Memphis): on a local business, a head-office / franchisor / agency inbox is still listed in the AI
 * Lookup panel with its label, but never becomes the main email by itself; a person presses Verify to use it.
 * Company leads (closures, exhibitors, review sites) are unaffected: the company is the target there.
 * Pure, safe in client components.
 */

export type EmailScope = "own" | "head_office" | "agency";

export interface EmailReach {
  emails?: string[];
  email_notes?: Record<string, string>;
  email_scope?: Record<string, EmailScope>;
}

/** For older results with no scope: a label naming a head office, franchise, parent, agency or organiser. */
const NOT_OWN_NOTE = /\b(corporate|franchis\w*|parent|head\s*office|headquarters|hq|agency|organi[sz]er)\b/i;

/** Does this email reach the business itself (this location / branch / its owner)? */
export function isOwnEmail(email: string, p: EmailReach): boolean {
  const key = email.toLowerCase();
  const scope = p.email_scope?.[key];
  if (scope) return scope === "own";
  const note = p.email_notes?.[key];
  return !(note && NOT_OWN_NOTE.test(note));
}

/** The first email (best first) that reaches the business itself, or null. */
export function firstOwnEmail(p: EmailReach): string | null {
  return (p.emails ?? []).find((e) => isOwnEmail(e, p)) ?? null;
}

/** The emails that reach a head office, franchisor or agency instead. */
export function notOwnEmails(p: EmailReach): string[] {
  return (p.emails ?? []).filter((e) => !isOwnEmail(e, p));
}
