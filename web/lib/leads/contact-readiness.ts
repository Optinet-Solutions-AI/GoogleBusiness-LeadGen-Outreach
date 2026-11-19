/**
 * leads/contact-readiness.ts — can we email / call this lead, in words the operator understands. Pure.
 *
 * Inputs:  the lead's contact fields (email, verification_status, phone, country_code, lifecycle_stage, call_status,
 *          contact_owner_name)
 * Outputs: emailState (+ label/tone), callBlock (why an AI call can't go, or null), hasOwner
 * Used by: components/leads/ContactCard.tsx, components/LeadsTable.tsx, lib/calls/quick-call.ts
 */

export type EmailState = "ready" | "likely" | "catch_all" | "unchecked" | "bad" | "none";

export interface ContactFields {
  email: string | null;
  verification_status: string | null;
  phone: string | null;
  country_code: string | null;
  lifecycle_stage?: string | null;
  call_status?: string | null;
  contact_owner_name?: string | null;
  /** Review-site leads can't be AI-called yet (no Voizo reputation script). */
  signal_type?: string | null;
  primary_offer?: string | null;
}

/** Offers the AI caller has no script for: never dialled (also checked by the call scheduler). */
export const NO_CALL_OFFERS = new Set(["reputation_mgmt"]);

/**
 * No AI-call script exists for this lead's pitch: review-site leads (by lead type, so one whose offer was never saved
 * is covered too) or any offer in NO_CALL_OFFERS. Used by callBlock and the call scheduler. Pure.
 */
export function noCallScript(f: { signal_type?: string | null; primary_offer?: string | null }): boolean {
  return f.signal_type === "review_site" || NO_CALL_OFFERS.has(f.primary_offer ?? "");
}

/** Countries the AI caller never dials (GDPR rule in the call scheduler). */
/**
 * Never AI-called (GDPR, Meny's rule): all EU countries, the rest of the EEA (NO, IS, LI), the UK, and "eu" — the
 * all-of-Europe value Europe-wide conference leads carry when the company's own country isn't known.
 */
export const NO_CALL_COUNTRIES = new Set([
  "eu", "gb",
  "at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu", "ie", "it", "lv", "lt", "lu", "mt",
  "nl", "pl", "pt", "ro", "sk", "si", "es", "se",
  "no", "is", "li",
]);

/** The country gate shared by the Call with AI button and the call worker. Pure. */
export function isNoCallCountry(code: string | null | undefined): boolean {
  return NO_CALL_COUNTRIES.has((code ?? "").trim().toLowerCase());
}

export function emailState(f: Pick<ContactFields, "email" | "verification_status">): EmailState {
  if (!f.email) return "none";
  switch (f.verification_status) {
    case "valid":
      return "ready";
    case "likely":
      return "likely";
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
  likely: {
    label: "Looks OK",
    tone: "positive",
    hint: "Passed the free check: written correctly, not a junk or throwaway address, and the domain takes email. Not proof the mailbox exists.",
  },
  catch_all: { label: "Catch-all", tone: "positive", hint: "The domain accepts any address — usually fine to send." },
  unchecked: { label: "Not checked", tone: "warning", hint: "Send email checks it first (free)." },
  bad: { label: "Bad address", tone: "urgent", hint: "The address bounced or doesn't exist. Find another one." },
  none: { label: "No email", tone: "muted", hint: "Try AI Lookup, or type one in." },
};

/** Why an AI call can't be placed, or null when it can. */
export function callBlock(f: ContactFields): string | null {
  if (noCallScript(f)) {
    return "AI calls don't pitch reputation management yet. Email this lead instead.";
  }
  if (!f.phone) return "No phone number on this lead.";
  const country = (f.country_code ?? "").toLowerCase();
  if (isNoCallCountry(country)) return "AI calls are off for this country (GDPR rule). Email instead.";
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
    canEmail: state === "ready" || state === "likely" || state === "catch_all" || state === "unchecked",
    callBlock: callBlock(f),
    hasOwner: !!f.contact_owner_name,
  };
}
