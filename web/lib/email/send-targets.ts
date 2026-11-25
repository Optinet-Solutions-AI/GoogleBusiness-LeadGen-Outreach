/**
 * email/send-targets.ts — Send email's "Send to: Email / Contact page / Both" rules. Pure.
 *
 * Inputs:  the choice + what the lead has (canEmail from the compose context, its own-site contact page)
 * Outputs: which channels go, and the plain reason when the choice can't be done
 * Used by: components/outreach/SimpleEmailModal.tsx (the Send to choice)
 *
 * Meny (25 Nov 2026): the same subject + message by email, through their contact form, or both at the same time.
 */
export type SendTarget = "email" | "form" | "both";

export const TARGET_LABEL: Record<SendTarget, string> = {
  email: "Email",
  form: "Contact page",
  both: "Both",
};

type LeadChannels = { canEmail: boolean; contactPage: string | null };

export function sendTargets(choice: SendTarget, lead: LeadChannels): { email: boolean; form: boolean; problem: string | null } {
  const email = choice !== "form";
  const form = choice !== "email";
  if (email && !lead.canEmail) return { email, form, problem: "This lead can't be emailed (no usable email address)." };
  if (form && !lead.contactPage) return { email, form, problem: "This lead has no contact page on its own website." };
  return { email, form, problem: null };
}

/** The choices the window offers: only channels this lead has (both only when it has both). */
export function targetChoices(lead: LeadChannels): SendTarget[] {
  if (lead.canEmail && lead.contactPage) return ["email", "form", "both"];
  if (lead.canEmail) return ["email"];
  if (lead.contactPage) return ["form"];
  return [];
}
