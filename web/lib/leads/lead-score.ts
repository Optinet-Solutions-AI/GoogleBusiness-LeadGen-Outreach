/**
 * leads/lead-score.ts — the OpenAI lead score's rules: what the AI is told, what it must answer, the bands (27 Nov 2026).
 *
 * Inputs:  a lead row (ScoreLead: business, rating, website check, AI Lookup, contact readiness, signal)
 * Outputs: factsFromLead (facts only, never an email address or phone number) · scoreInput (the text the AI reads) ·
 *          SCORE_SCHEMA / SCORE_INSTRUCTIONS · parseScore (checked answer → LeadScore) · bandOf / bandLabel ·
 *          scoreWait (the 2-minute "Score again" cooldown) · byScoreDesc (high first, unscored last)
 * Used by: lib/leads/lead-score-run.ts (one lead), lib/leads/lead-score-batch.ts, lib/pipeline/stage-1-scrape.ts,
 *          the Leads list / batch / lead pages, lib/brain (ordering), lib/campaigns/batch-email-plan.ts
 *
 * Pure (safe in client components). The score = how likely this business is to reply AND buy the offer we'd pitch it.
 * It never blocks or contacts a lead by itself (spec docs/superpowers/specs/2026-11-27-lead-score-and-cost-per-reply-design.md).
 */
import { resolveSegment } from "@/lib/segment";
import { defaultService, SERVICES } from "@/lib/email/service-templates";
import { isOwnEmail, type EmailReach } from "./email-reach";

export type ScoreBand = "hot" | "warm" | "cold";

export interface LeadScore {
  score: number;
  band: ScoreBand;
  reasons: string[];
  holding_back: string;
  model: string;
  usd: number;
  scored_at: string;
}

/** What the lists show: the number, its band and why. */
export interface ScoreSummary {
  score: number;
  band: ScoreBand;
  reasons: string[];
  holding_back: string;
}

/** The lead fields scoring reads (SCORE_LEAD_COLS in lead-score-run.ts selects exactly these). */
export interface ScoreLead {
  id: string;
  business_name: string;
  category: string | null;
  address: string | null;
  country_code: string | null;
  rating: number | null;
  review_count: number | null;
  email: string | null;
  verification_status: string | null;
  phone: string | null;
  contact_page_url: string | null;
  contact_owner_name: string | null;
  website_url: string | null;
  website_review: { verdict?: string; score?: number; summary?: string; reasons?: string[]; pitch?: { why?: string } } | null;
  ai_profile: (EmailReach & { summary?: unknown }) | null;
  signal_type: string | null;
  signal_meta: Record<string, unknown> | null;
  call_segment: string | null;
  has_website: boolean | null;
  website_kind: string | null;
  needs_improvement: boolean | null;
  primary_offer: string | null;
}

export type EmailFact = "own_verified" | "own_unchecked" | "head_office" | "bad" | "none";

export interface ScoreFacts {
  business_name: string;
  category: string | null;
  place: string | null;
  rating: number | null;
  review_count: number | null;
  segment: string;
  offer_label: string;
  /** One line from the AI website check, or "not checked". */
  website: string;
  research: string | null;
  signal: string | null;
  email: EmailFact;
  has_phone: boolean;
  has_contact_page: boolean;
  owner_known: boolean;
}

export const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "reasons", "holding_back"],
  properties: {
    score: { type: "integer", description: "0–100: how likely this business is to reply and buy the offer" },
    reasons: { type: "array", items: { type: "string" }, description: "2–3 short reasons, each naming a fact given" },
    holding_back: { type: "string", description: "The one thing that lowers the score most" },
  },
} as const;

export const SCORE_INSTRUCTIONS = [
  "You score one local business as a sales lead for a small agency.",
  "The score (0–100) is how likely this business is to reply to us AND buy the offer named below.",
  "Use ONLY the facts given. Never assume a fact that isn't there. A fact marked unknown lowers your confidence: keep the score nearer the middle instead of guessing.",
  "Give 2 or 3 short reasons. Each reason must name a fact from the input (for example the rating, the website check, whether an email was found).",
  "holding_back = the one thing that lowers the score most, in a few words.",
  "70–100 = very promising, 40–69 = worth a try, 0–39 = unlikely.",
].join("\n");

const COOLDOWN_SECONDS = 120;

export function bandOf(score: number): ScoreBand {
  return score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";
}

export function bandLabel(b: ScoreBand): string {
  return b === "hot" ? "Hot" : b === "warm" ? "Warm" : "Cold";
}

/** "123 Main St, Austin, TX 78701, USA" → "Austin, TX 78701, USA"; a short address is kept as it is. */
function placeOf(address: string): string {
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 3 ? parts.slice(1).join(", ") : parts.join(", ");
}

const clip = (v: unknown, n: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** A date (2026-11-27, 2026/11/27) or a year range (1998-2024): kept, not a phone number. */
const DATE_LIKE = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}\s?[-–]\s?\d{4})$/;

/** Free text (research summary, website check, signal) can quote an email or a phone number: never send those. */
export function scrubContacts(text: string): string {
  return text
    .replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\+?\(?\d[\d\s().-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length < 7 || DATE_LIKE.test(m.trim()) ? m : "[phone]"));
}

function emailFact(l: ScoreLead): EmailFact {
  const email = l.email?.trim();
  if (!email) return "none";
  if (l.verification_status === "invalid") return "bad";
  if (l.ai_profile && !isOwnEmail(email, l.ai_profile)) return "head_office";
  return l.verification_status === "valid" || l.verification_status === "catch-all" || l.verification_status === "likely" ? "own_verified" : "own_unchecked";
}

function websiteLine(l: ScoreLead): string {
  const w = l.website_review;
  if (!w?.verdict) return l.website_url ? "not checked by AI (has a website on file)" : "not checked (no website on file)";
  const reasons = w.reasons?.length ? ` Reasons: ${w.reasons.map((r) => clip(r, 120)).slice(0, 4).join("; ")}.` : "";
  return scrubContacts(`${w.verdict.replace(/_/g, " ")}${typeof w.score === "number" ? `, score ${w.score}/100` : ""}. ${clip(w.summary, 300)}${reasons}`.trim());
}

function signalLine(l: ScoreLead): string | null {
  if (!l.signal_type) return null;
  const m = l.signal_meta ?? {};
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  let text: string;
  if (l.signal_type === "review_site") {
    text = `Low rating on ${s(m.platform) ?? "a review site"}: ${s(m.rating) ?? "?"}★ from ${s(m.review_count) ?? "?"} reviews`;
  } else if (l.signal_type === "exhibitor") {
    text = `Had a stand at ${s(m.event_name) ?? "a trade show"}${s(m.booth) ? ` (stand ${s(m.booth)})` : ""}`;
  } else {
    const when = s(m.notice_date) ?? s(m.filed);
    text = `Public ${l.signal_type} notice${when ? ` dated ${when}` : ""}`;
  }
  return scrubContacts(clip(text, 200));
}

/** The facts the AI may use. Contact data becomes yes/no facts: no email address, no phone number. */
export function factsFromLead(l: ScoreLead): ScoreFacts {
  const segment = resolveSegment(l);
  const key = defaultService(segment);
  const summary = scrubContacts(clip(l.ai_profile?.summary, 600));
  return {
    business_name: clip(l.business_name, 120),
    category: l.category ? clip(l.category, 80) : null,
    // The town and country, not the street (the AI doesn't need where the door is).
    place: l.address ? clip(placeOf(l.address), 120) : null,
    rating: typeof l.rating === "number" ? l.rating : null,
    review_count: typeof l.review_count === "number" ? l.review_count : null,
    segment,
    offer_label: SERVICES.find((x) => x.key === key)?.label ?? key,
    website: websiteLine(l),
    research: summary || null,
    signal: signalLine(l),
    email: emailFact(l),
    has_phone: !!l.phone?.trim(),
    has_contact_page: !!l.contact_page_url?.trim(),
    owner_known: !!l.contact_owner_name?.trim(),
  };
}

const EMAIL_TEXT: Record<EmailFact, string> = {
  own_verified: "yes, the business's own address, checked",
  own_unchecked: "yes, the business's own address, not checked yet",
  head_office: "only a head office / agency inbox",
  bad: "the address on file bounces or is invalid",
  none: "none found",
};

/** The text the AI reads about one lead. */
export function scoreInput(f: ScoreFacts): string {
  return [
    `Business: ${f.business_name}`,
    `Type: ${f.category ?? "unknown"}`,
    `Place: ${f.place ?? "unknown"}`,
    `Google rating: ${f.rating ?? "unknown"}${f.review_count != null ? ` (${f.review_count} reviews)` : ""}`,
    `Segment: ${f.segment.replace(/_/g, " ")}`,
    `Offer we would pitch: ${f.offer_label}`,
    `Website check: ${f.website}`,
    `Research summary: ${f.research ?? "none"}`,
    ...(f.signal ? [`Signal: ${f.signal}`] : []),
    `Email: ${EMAIL_TEXT[f.email]}`,
    `Phone: ${f.has_phone ? "yes" : "no"}`,
    `Contact form page: ${f.has_contact_page ? "yes" : "no"}`,
    `Owner's name known: ${f.owner_known ? "yes" : "no"}`,
  ].join("\n");
}

/** The AI's answer, checked. null = unusable (no number, or no reason backing it). */
export function parseScore(raw: unknown, meta: { model: string; usd: number; scored_at: string }): LeadScore | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.score !== "number" || !Number.isFinite(o.score)) return null;
  const reasons = (Array.isArray(o.reasons) ? o.reasons : [])
    .filter((r): r is string => typeof r === "string" && r.trim() !== "")
    .map((r) => clip(r, 200))
    .slice(0, 3);
  if (!reasons.length) return null;
  const score = Math.max(0, Math.min(100, Math.round(o.score)));
  return { score, band: bandOf(score), reasons, holding_back: clip(o.holding_back, 200), ...meta };
}

/** Seconds left before "Score again" may run (0 = may run now). */
export function scoreWait(lastAt: string | null, now: Date): number {
  if (!lastAt) return 0;
  const t = Date.parse(lastAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil(COOLDOWN_SECONDS - (now.getTime() - t) / 1000));
}

/** Sort: high scores first, unscored last; ties keep their order (Array.prototype.sort is stable). */
export function byScoreDesc(a: { lead_score?: number | null }, b: { lead_score?: number | null }): number {
  const x = typeof a.lead_score === "number" ? a.lead_score : -1;
  const y = typeof b.lead_score === "number" ? b.lead_score : -1;
  return y - x;
}
