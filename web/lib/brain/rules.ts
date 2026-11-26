/**
 * brain/rules.ts — what the Brain may do with a lead, and its money rules (26 Nov 2026). Pure.
 *
 * Inputs:  a lead's facts (segment, can it be emailed / reached by form / called), the job's settings, the AI's answer
 * Outputs: the allowed offers and channels, the checked decision (the AI's when it stays inside the lists, else the
 *          standard rule), cleaned settings, the job estimate, canSpend
 * Used by: lib/brain/{command,jobs,plan,approve,runner,control,view}.ts and the Brain page
 *
 * The AI never acts: it only picks among the offers and channels listed here. Anything it returns outside those lists
 * is replaced by the standard rule (the offer Send email would start on, every allowed channel). Workflow:
 * workflows/run_brain_job.md.
 */
import type { ServiceKey } from "@/lib/email/service-templates";

export type Channel = "email" | "form" | "call";
export const CHANNELS: readonly Channel[] = ["email", "form", "call"];

export type JobStatus = "asking" | "searching" | "planning" | "review" | "running" | "paused" | "done" | "cancelled" | "failed";

export interface JobSettings {
  budgetUsd: number;
  channels: Record<Channel, boolean>;
  perDay: { emails: number; forms: number; calls: number };
  followUps: 0 | 1 | 2 | 3;
  includeEu: boolean;
}

/** The operator's defaults (26 Nov 2026): $20, every channel, 10 emails / 10 forms / 5 calls a day, no follow-ups, EU/UK out. */
export const DEFAULT_SETTINGS: JobSettings = {
  budgetUsd: 20,
  channels: { email: true, form: true, call: true },
  perDay: { emails: 10, forms: 10, calls: 5 },
  followUps: 0,
  includeEu: false,
};

/** Most leads in one job (the Apify search cap). */
export const MAX_COUNT = 300;
/** About what judging one lead costs (one small OpenAI call). */
export const JUDGE_USD_PER_LEAD = 0.01;
/** About what one contact form send costs (OPENAI_FORM_USD_ESTIMATE's default). */
export const FORM_USD = 0.1;
/** The AI call comes this many days after the first touch (Meny, 25 Nov 2026). */
export const CALL_DELAY_DAYS = 2;

const clamp = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.min(max, Math.max(min, n));
};

/** Settings from the browser, clamped: budget $1–500, emails 1–30, forms 0–20, calls 0–20, follow-ups 0–3. */
export function cleanSettings(raw: unknown): JobSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof JobSettings, unknown>>;
  const ch = (r.channels && typeof r.channels === "object" ? r.channels : {}) as Record<string, unknown>;
  const pd = (r.perDay && typeof r.perDay === "object" ? r.perDay : {}) as Record<string, unknown>;
  const on = (k: Channel) => (typeof ch[k] === "boolean" ? (ch[k] as boolean) : k in ch ? false : DEFAULT_SETTINGS.channels[k]);
  return {
    budgetUsd: Math.round(clamp(r.budgetUsd, 1, 500, DEFAULT_SETTINGS.budgetUsd) * 100) / 100,
    channels: { email: on("email"), form: on("form"), call: on("call") },
    perDay: {
      emails: Math.round(clamp(pd.emails, 1, 30, DEFAULT_SETTINGS.perDay.emails)),
      forms: Math.round(clamp(pd.forms, 0, 20, DEFAULT_SETTINGS.perDay.forms)),
      calls: Math.round(clamp(pd.calls, 0, 20, DEFAULT_SETTINGS.perDay.calls)),
    },
    followUps: Math.round(clamp(r.followUps, 0, 3, DEFAULT_SETTINGS.followUps)) as 0 | 1 | 2 | 3,
    includeEu: r.includeEu === true,
  };
}

const OFFERS_BY_SEGMENT: Record<string, ServiceKey[]> = {
  // Needs a site: the website first, or an AI service (SEO needs a site to rank).
  no_website: ["website_build", "ai_receptionist", "ai_booking"],
  old_website: ["website_redesign", "ai_receptionist", "ai_booking", "seo"],
  // A good website is NEVER pitched a website (offer strategy, CLAUDE.md).
  has_website: ["ai_receptionist", "ai_booking", "seo"],
  liquidation: ["buy_inventory"],
  exhibitor: ["booth_build"],
  reputation: ["reputation_mgmt"],
};

/** What a lead of this segment may be offered, the usual offer first. Unknown segment → nothing. */
export function allowedOffers(segment: string | null): ServiceKey[] {
  return segment ? [...(OFFERS_BY_SEGMENT[segment] ?? [])] : [];
}

/** What the code knows about a lead before the AI is asked. */
export interface LeadFacts {
  id: string;
  segment: string | null;
  /** Why the batch-email rules would not email it (plain words), or null when they would. */
  emailSkip: string | null;
  /** It has a contact page / website on its own site. */
  hasForm: boolean;
  /** Why it can't be called (plain words), or null when it can. */
  callBlock: string | null;
  inOtherJob: boolean;
  /** The offers Voizo has a script for. */
  callOffers: string[];
}

export interface Moves {
  offers: ServiceKey[];
  channels: Channel[];
  /** The plain reason when nothing can be done with this lead. */
  skip: string | null;
}

export function allowedMoves(f: LeadFacts, s: JobSettings): Moves {
  const offers = allowedOffers(f.segment);
  const channels: Channel[] = [];
  if (s.channels.email && f.emailSkip === null) channels.push("email");
  if (s.channels.form && f.hasForm) channels.push("form");
  if (s.channels.call && f.callBlock === null && offers.some((o) => f.callOffers.includes(o))) channels.push("call");
  if (f.inOtherJob) return { offers, channels: [], skip: "Already in another brain job" };
  if (!offers.length) return { offers, channels: [], skip: "No offer fits this lead" };
  if (!channels.length) {
    const why = [
      f.emailSkip,
      f.hasForm ? null : "no contact form on their site",
      f.callBlock ?? (offers.some((o) => f.callOffers.includes(o)) ? null : "no AI call script for its offer"),
    ].filter(Boolean);
    return { offers, channels, skip: `No way to reach this lead (${why.join("; ")})` };
  }
  return { offers, channels, skip: null };
}

export interface Decision {
  contact: boolean;
  offer: ServiceKey | null;
  channels: Channel[];
  /** One plain sentence. */
  reason: string;
  /** ai = the AI's answer stood · rule = the code skipped it · default = the AI's answer was unusable or it wasn't asked. */
  source: "ai" | "rule" | "default";
}

/** A call needs a Voizo script for the offer. */
const callable = (offer: ServiceKey, channels: Channel[], f: LeadFacts): Channel[] =>
  f.callOffers.includes(offer) ? channels : channels.filter((c) => c !== "call");

/** The standard rule: a code skip stays a skip; else the usual offer on every allowed channel. */
export function defaultDecision(m: Moves, f: LeadFacts): Decision {
  if (m.skip) return { contact: false, offer: null, channels: [], reason: m.skip, source: "rule" };
  const offer = m.offers[0];
  return { contact: true, offer, channels: callable(offer, m.channels, f), reason: "Standard rule: the usual offer for this kind of lead, on every channel it has.", source: "default" };
}

/** The AI's answer, kept only when it stays inside the allowed lists. */
export function validateDecision(raw: unknown, m: Moves, f: LeadFacts): Decision {
  const dflt = defaultDecision(m, f);
  if (m.skip) return dflt;
  if (!raw || typeof raw !== "object") return dflt;
  const r = raw as { contact?: unknown; offer?: unknown; channels?: unknown; reason?: unknown };
  if (typeof r.contact !== "boolean") return dflt;
  const reason = (typeof r.reason === "string" ? r.reason.replace(/\s+/g, " ").trim() : "").slice(0, 240);
  if (!r.contact) return { contact: false, offer: null, channels: [], reason: reason || "The AI chose to skip this lead.", source: "ai" };
  if (typeof r.offer !== "string" || !(m.offers as string[]).includes(r.offer)) return dflt;
  if (!Array.isArray(r.channels) || !r.channels.length) return dflt;
  if (r.channels.some((c) => typeof c !== "string" || !(m.channels as string[]).includes(c))) return dflt;
  const offer = r.offer as ServiceKey;
  // In the fixed order, each once; the call is dropped when Voizo has no script for this offer.
  const channels = callable(offer, CHANNELS.filter((c) => (r.channels as string[]).includes(c)), f);
  if (!channels.length) return dflt;
  return { contact: true, offer, channels, reason: reason || "Chosen by the AI.", source: "ai" };
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** What a job is expected to cost this app (AI calls are billed by Voizo, not here). */
export function jobEstimate(o: { searchUsd: number; leads: number; formLeads: number }): { searchUsd: number; judgeUsd: number; formsUsd: number; totalUsd: number } {
  const searchUsd = cents(o.searchUsd);
  const judgeUsd = cents(o.leads * JUDGE_USD_PER_LEAD);
  const formsUsd = cents(o.formLeads * FORM_USD);
  return { searchUsd, judgeUsd, formsUsd, totalUsd: cents(searchUsd + judgeUsd + formsUsd) };
}

/** May the next paid step run? Never past the budget. */
export function canSpend(spent: number, next: number, budget: number): boolean {
  return spent + next <= budget + 0.0001;
}
