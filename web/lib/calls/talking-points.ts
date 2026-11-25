/**
 * calls/talking-points.ts — the email as background for the voice agent ("talkingPoints", 25 Nov 2026, Meny). Pure.
 *
 * Inputs:  the call's offer; the last email the lead got (subject, body, which email it was) or null; the lead's
 *          details for the offer's ready-made email
 * Outputs: one paragraph of prose, at most 500 characters (Voizo rejects longer), and where it came from
 * Used by: lib/calls/talking-points-load.ts (real calls + test calls), components/outreach/VoiceTestModal.tsx (shown)
 *
 * Meny wants the call to say what the email says. Voizo takes `variables.talkingPoints`: background for the pitch,
 * never read aloud, put in the agent's own words. Prose, not bullets (Voizo's advice). The email the lead got is used
 * when it was for the same offer; otherwise that offer's ready-made email. Greeting, sign-off and links are dropped.
 */
import { isServiceKey, serviceEmail, type ServiceKey, type TemplateLead } from "@/lib/email/service-templates";

/** Voizo's limit: a longer value is refused (400 variable_too_long), never cut. */
export const TALKING_POINTS_MAX = 500;

/** The last email sent to the lead, and which email it was (outreach_events meta.email_used.key). */
export interface LastEmail {
  subject: string;
  body: string;
  /** "service:<offer>" / "saved:<template id>"; null = not recorded (older or sequence emails). */
  usedKey: string | null;
  /** For a saved template: the offer it was written for (null = any offer). */
  templateOffer: string | null;
}

export interface TalkingPoints {
  text: string;
  source: "sent" | "ready_made";
}

/** Old offer names (leads.primary_offer) → the Send email offers. */
const OLD_NAMES: Record<string, ServiceKey> = {
  build_website: "website_build",
  improve_website: "website_redesign",
  voice_agent: "ai_receptionist",
};

/** The Send email offer for an offer name; "custom" or unknown → null. */
export function serviceOffer(offer: string | null | undefined): ServiceKey | null {
  if (!offer) return null;
  const key = OLD_NAMES[offer] ?? offer;
  return isServiceKey(key) && key !== "custom" ? key : null;
}

/** The offer an email was for, from its email_used key; unknown → null. */
export function emailOffer(usedKey: string | null | undefined, templateOffer: string | null | undefined): ServiceKey | null {
  if (!usedKey) return null;
  if (usedKey.startsWith("service:")) return serviceOffer(usedKey.slice("service:".length));
  if (usedKey.startsWith("saved:")) return serviceOffer(templateOffer);
  return null;
}

const GREETING_RX = /^(hi|hey|hello|dear|good (morning|afternoon|evening))\b.{0,60}$/i;
const SIGN_OFF_RX = /^(thanks|thank you|many thanks|best|best regards|kind regards|regards|cheers|all the best|warm regards|talk soon)[,.!]?$/i;
const URL_RX = /\b(https?:\/\/|www\.)\S+/gi;
const UNSUB_RX = /unsubscribe|reply (stop|no)\b|opt.?out/i;

/** Cut to at most `max` characters: at the end of a sentence when one fits, else at a word, ending with a full stop. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (end > max / 2) return head.slice(0, end + 1);
  const words = head.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[,;:\s-]+$/, "");
  return `${words}.`;
}

/** The email as one paragraph of prose for the agent: subject first, no greeting / sign-off / links, ≤ 500 chars. */
export function talkingPointsFromEmail(subject: string, body: string): string {
  let lines = body.split(/\r?\n/).map((l) => l.trim());
  const first = lines.findIndex((l) => l);
  if (first >= 0 && GREETING_RX.test(lines[first]) && lines[first].endsWith(",")) lines = lines.slice(first + 1);
  const bye = lines.findIndex((l) => SIGN_OFF_RX.test(l));
  if (bye >= 0) lines = lines.slice(0, bye);
  const sentences = lines
    .filter((l) => !UNSUB_RX.test(l))
    .map((l) => l.replace(URL_RX, "").replace(/\s+/g, " ").trim())
    // A line that led into a link ("…could look like:") now ends the sentence.
    .map((l) => l.replace(/\s*:$/, "."))
    .filter((l) => /[a-z0-9]/i.test(l));
  const s = subject.replace(/\s+/g, " ").trim();
  if (!sentences.length) return "";
  const text = [s ? `Email subject: ${s.replace(/[.!?]*$/, "")}.` : "", ...sentences].filter(Boolean).join(" ");
  return fit(text, TALKING_POINTS_MAX);
}

/** The lead columns the ready-made email needs. */
export interface TalkingLead {
  business_name: string | null;
  contact_owner_name?: string | null;
  category?: string | null;
  demo_url?: string | null;
  signal_meta?: Record<string, unknown> | null;
}

const PLATFORM_NAME: Record<string, string> = { trustpilot: "Trustpilot", tripadvisor: "TripAdvisor" };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The lead as the ready-made emails take it (same details as Send email / batch email). */
export function templateLeadOf(l: TalkingLead, city?: string | null): TemplateLead {
  const m = l.signal_meta ?? {};
  const platform = str(m.platform);
  return {
    businessName: l.business_name ?? "",
    ownerName: l.contact_owner_name ?? null,
    city: city ?? null,
    category: l.category ?? null,
    demoUrl: l.demo_url ?? null,
    eventName: str(m.event_name),
    booth: str(m.booth),
    platform: platform ? (PLATFORM_NAME[platform.toLowerCase()] ?? platform) : null,
    rating: num(m.rating),
    reviewCount: num(m.review_count),
  };
}

/**
 * The talking points for a call: the email the lead got when it was for this offer, else the offer's ready-made
 * email filled in for the lead. Null when the offer has no email (e.g. "write my own").
 */
export function pickTalkingPoints(offer: string | null | undefined, last: LastEmail | null, lead: TemplateLead): TalkingPoints | null {
  const key = serviceOffer(offer);
  if (!key) return null;
  if (last && emailOffer(last.usedKey, last.templateOffer) === key) {
    const text = talkingPointsFromEmail(last.subject, last.body);
    if (text) return { text, source: "sent" };
  }
  const e = serviceEmail(key, lead);
  const text = talkingPointsFromEmail(e.subject, e.body);
  return text ? { text, source: "ready_made" } : null;
}
