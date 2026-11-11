/**
 * leads/contact-readiness.ts — can we email / call this lead, in words the operator understands. Pure.
 *
 * Inputs:  the lead's contact fields (email, verification_status, phone, country_code, lifecycle_stage, call_status,
 *          contact_owner_name)
 * Outputs: emailState (+ label/tone), callBlock (why an AI call can't go, or null), hasOwner
 * Used by: components/leads/ContactCard.tsx, components/LeadsTable.tsx, lib/calls/quick-call.ts
 */

export type EmailState = "ready" | "catch_all" | "unchecked" | "bad" | "none";

export interface ContactFields {
  email: string | null;
  verification_status: string | null;
  phone: string | null;
  country_code: string | null;
  lifecycle_stage?: string | null;
  call_status?: string | null;
  contact_owner_name?: string | null;
}

/** Countries the AI caller never dials (GDPR rule in the call scheduler). */
export const NO_CALL_COUNTRIES = new Set(["gb", "ie", "de", "fr", "es", "it", "pt", "nl", "se", "no", "pl", "gr", "mt"]);

export function emailState(f: Pick<ContactFields, "email" | "verification_status">): EmailState {
  if (!f.email) return "none";
  switch (f.verification_status) {
    case "valid":
      return "ready";
    case "catch-all":
      return "catch_all";
    case "invalid":
      return "bad";
    default:
      return "unchecked";
  }
}

export const EMAIL_STATE_LABEL: Record<EmailState, { label: string; tone: "positive" | "warning" | "urgent" | "muted"; hint: string }> = {
  ready: { label: "Ready to send", tone: "positive", hint: "Checked: the address exists." },
  catch_all: { label: "Catch-all", tone: "positive", hint: "The domain accepts any address — usually fine to send." },
  unchecked: { label: "Not checked", tone: "warning", hint: "Send email checks it first (under 1 cent)." },
  bad: { label: "Bad address", tone: "urgent", hint: "The address bounced or doesn't exist. Find another one." },
  none: { label: "No email", tone: "muted", hint: "Try Find contacts (AI), or type one in." },
};

/** Why an AI call can't be placed, or null when it can. */
export function callBlock(f: ContactFields): string | null {
  if (!f.phone) return "No phone number on this lead.";
  const country = (f.country_code ?? "").toLowerCase();
  if (NO_CALL_COUNTRIES.has(country)) return "AI calls are off for this country (GDPR rule). Email instead.";
  if (f.lifecycle_stage === "dnc" || f.call_status === "dnc") return "This lead asked not to be called.";
  if (f.lifecycle_stage === "unsubscribed") return "This lead unsubscribed.";
  if (f.call_status === "bad_number") return "An earlier call found this number wrong.";
  if (f.call_status === "not_interested") return "An earlier call: not interested. Not called again.";
  if (f.call_status === "qualified") return "Already interested after a call — follow up by hand (Inbox).";
  return null;
}

export function contactReadiness(f: ContactFields) {
  const state = emailState(f);
  return {
    emailState: state,
    email: EMAIL_STATE_LABEL[state],
    canEmail: state === "ready" || state === "catch_all" || state === "unchecked",
    callBlock: callBlock(f),
    hasOwner: !!f.contact_owner_name,
  };
}
