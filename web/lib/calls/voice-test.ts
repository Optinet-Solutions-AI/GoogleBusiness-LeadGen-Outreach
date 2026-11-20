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
import { resolveSegment } from "@/lib/segment";
import { defaultService, SERVICES } from "@/lib/email/service-templates";

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

/** The offers the test window can pick: the same list as Send email, without "write my own". */
export const VOICE_OFFERS = SERVICES.filter((s) => s.key !== "custom");

/** How an offer is said out loud ({{offer}}); unknown → "". */
export function offerWords(key: string | null | undefined): string {
  return key ? (OFFER_WORDS[key] ?? "") : "";
}

export interface VoiceLead {
  business_name: string;
  contact_owner_name: string | null;
  category: string | null;
  primary_offer: string | null;
  signal_type: string | null;
  signal_meta: Record<string, unknown> | null;
  // For the starting offer (same as Send email): segment inputs.
  call_segment?: string | null;
  has_website?: boolean | null;
  website_kind?: string | null;
  needs_improvement?: boolean | null;
}

/** The offer the test window starts on, and what real calls pitch: what Send email would pick for this lead. */
export function defaultVoiceOffer(lead: VoiceLead): string | null {
  const key = defaultService(resolveSegment(lead));
  return key === "custom" ? offerForLead(lead) : key;
}

export type VoiceVariables = Partial<
  Record<"business" | "category" | "offer" | "event" | "booth" | "city" | "site" | "rating" | "reviews", string>
>;

const SITE_NAME: Record<string, string> = { trustpilot: "Trustpilot", tripadvisor: "TripAdvisor" };
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

const text = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 200) : "");

/**
 * The lead details Voizo accepts (its whitelist); empty values are left out. `offerKey` = the offer picked;
 * `batchCity` = the batch's city ("Austin, TX" → "Austin").
 */
export function voiceVariables(lead: VoiceLead, offerKey?: string | null, batchCity?: string | null): VoiceVariables {
  const offer = offerKey ?? offerForLead(lead);
  const meta = lead.signal_meta ?? {};
  const platform = text(meta.platform).toLowerCase();
  const rating = num(meta.rating);
  const reviews = num(meta.review_count);
  const all: VoiceVariables = {
    business: text(lead.business_name),
    category: text(lead.category),
    offer: offer ? text(OFFER_WORDS[offer] ?? offer.replace(/_/g, " ")) : "",
    event: text(lead.signal_meta?.event_name),
    booth: text(lead.signal_meta?.booth),
    // A 2-letter batch "city" is a region code (eu, TX, US), not a city.
    city: ((c) => (c.length > 2 ? c : ""))(text((batchCity ?? "").split(",")[0])),
    site: platform ? (SITE_NAME[platform] ?? text(meta.platform)) : "",
    rating: rating ? `${rating} stars` : "",
    reviews: reviews ? `${reviews} reviews` : "",
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

/** One Voizo script (GET /api/v1/scripts). */
export interface VoiceScript {
  campaignId: string;
  offerKey: string | null;
  name: string;
  scriptVariables: string[] | null;
  canDial: boolean;
}

/** The Voizo script for the offer picked; none for that offer (or one not named to convention) → null. */
export function pickScript<T extends Pick<VoiceScript, "offerKey">>(scripts: T[], offerKey: string | null): T | null {
  if (!offerKey) return null;
  return scripts.find((s) => s.offerKey === offerKey) ?? null;
}

/** The first text message Vapi put anywhere in an error event (it nests them differently by source). */
function errorMessage(e: unknown): string | null {
  const o = e as Record<string, unknown> | null;
  const inner = (o?.error ?? null) as Record<string, unknown> | null;
  const deeper = (inner?.error ?? null) as Record<string, unknown> | null;
  for (const c of [o?.errorMsg, o?.message, o?.msg, inner?.message, inner?.msg, inner?.errorMsg, deeper?.message, deeper?.msg, e]) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** The agent (or Vapi) hanging up arrives as an "error" saying the meeting ended: that's a normal end. */
export function isNormalCallEnd(e: unknown): boolean {
  return /meeting (has )?ended|ejection/i.test(errorMessage(e) ?? "");
}

/** A real browser-call error in plain words. */
export function voiceErrorText(e: unknown): string {
  return errorMessage(e) ?? "The test call stopped with an error.";
}

/** The browser call's conversation as saved in Call logs: one line per turn, the tester shown as "Tester". */
export function testCallTranscript(lines: { role: string; text: string }[]): string {
  return lines.map((l) => `${l.role === "Agent" ? "Agent" : "Tester"}: ${l.text.trim()}`).join("\n");
}
