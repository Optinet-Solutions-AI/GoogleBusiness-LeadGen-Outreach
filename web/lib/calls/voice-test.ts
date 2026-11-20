/**
 * calls/voice-test.ts — what the voice agent is told about a lead (20 Nov 2026). Pure.
 *
 * Inputs:  the lead (business, owner, category, offer, conference show/stand) + an optional greeting typed in the window
 * Outputs: Voizo's lead variables (whitelist: business, category, offer, event, booth — playerName comes from `name`),
 *          the greeting name, and which of the script's tokens this lead can't fill
 * Used by: lib/calls/voice-test-start.ts (browser test calls), lib/pipeline/call-scheduler.ts (real calls),
 *          components/outreach/VoiceTestModal.tsx
 *
 * Voizo strips a token with no value and tidies the sentence, silently — so the window warns before a call
 * (missingScriptVariables against GET /api/v1/status scriptVariables).
 */
import { offerForLead } from "@/lib/offers";

/** How each offer is said out loud. */
const OFFER_WORDS: Record<string, string> = {
  build_website: "a new website",
  website_build: "a new website",
  improve_website: "a website redesign",
  website_redesign: "a website redesign",
  voice_agent: "an AI receptionist that answers your calls",
  ai_receptionist: "an AI receptionist that answers your calls",
  ai_booking: "an AI booking assistant",
  seo: "showing up higher on Google",
  buy_inventory: "buying your remaining inventory",
  booth_build: "an exhibition stand, designed and built for your next show",
  reputation_mgmt: "improving your online reviews",
};

export interface VoiceLead {
  business_name: string;
  contact_owner_name: string | null;
  category: string | null;
  primary_offer: string | null;
  signal_type: string | null;
  signal_meta: Record<string, unknown> | null;
}

export type VoiceVariables = Partial<Record<"business" | "category" | "offer" | "event" | "booth", string>>;

const text = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 200) : "");

/** The lead details Voizo accepts (its whitelist); empty values are left out. */
export function voiceVariables(lead: VoiceLead): VoiceVariables {
  const offer = offerForLead(lead);
  const all: VoiceVariables = {
    business: text(lead.business_name),
    category: text(lead.category),
    offer: offer ? text(OFFER_WORDS[offer] ?? offer.replace(/_/g, " ")) : "",
    event: text(lead.signal_meta?.event_name),
    booth: text(lead.signal_meta?.booth),
  };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v)) as VoiceVariables;
}

/** The first name the agent greets (Voizo's playerName): typed in the window, else the owner's first name. */
export function greetingFor(lead: Pick<VoiceLead, "contact_owner_name">, typed?: string | null): string | null {
  return (typed ?? "").trim() || (lead.contact_owner_name ?? "").trim().split(/[\s,]+/)[0] || null;
}

/** The script's tokens this lead has no value for; null when Voizo couldn't read the script (unknown, not "complete"). */
export function missingScriptVariables(scriptVariables: string[] | null, vars: VoiceVariables, greeting: string | null): string[] | null {
  if (scriptVariables == null) return null;
  const have = new Set<string>(Object.keys(vars));
  if (greeting) have.add("playerName");
  return scriptVariables.filter((t) => !have.has(t));
}
