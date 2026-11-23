/**
 * calls/train-agent-view.ts — "Train a voice agent": the request the window sends, the shapes it shows, and the plain
 * sentence for every way Voizo can say no. Pure (no db, no network), safe to import in client components.
 *
 * Inputs:  the POST body of /api/voice-training; a Voizo error code; a script line or list of lines; Voizo's reply
 * Outputs: trainRequest (zod) · trainErrorText(code) · asLines(before/after) · groupEdits(edits) ·
 *          splitHeadsUp(reply) · sharedWarning(reply, proposal) · historyTurns(bubbles) · clipHistory(turns)
 * Used by: app/api/voice-training/route.ts, lib/calls/train-agent.ts, components/voice/TrainAgentModal.tsx
 *
 * The script lives in Voizo; this app only passes the operator's words along and shows what Voizo proposes.
 */
import { z } from "zod";

/** One line (or box of lines) the agent would change: what it says now → what it would say. */
export interface TrainEdit {
  label: string;
  before: string | string[];
  after: string | string[];
}
export interface TrainProposal {
  id: string;
  expiresAt?: string | null;
  /** Voizo's flag: the change reaches every offer's agent (a standing answer). */
  sharedAcrossOffers?: boolean | null;
  edits: TrainEdit[];
}
/** A saved change, from Voizo's history. */
export interface TrainChange {
  id: string;
  instruction?: string | null;
  summary?: string | null;
  actor?: string | null;
  appliedAt?: string | null;
  undoneAt?: string | null;
  edits?: TrainEdit[] | null;
}
export interface TrainTurn {
  role: "user" | "assistant";
  text: string;
}
/** An offer's script that can be trained. */
export interface TrainableAgent {
  campaignId: string;
  offerKey: string | null;
  label: string;
}

const MAX_TURNS = 10;
const MAX_TEXT = 1000;
const campaignId = z.string().trim().min(1, "Pick which agent to train").max(100);
const turn = z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) });

export const trainRequest = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ask"),
    campaignId,
    message: z.string().trim().min(1, "Say or type what to change first").max(MAX_TEXT, "That's too long (1,000 characters max). Say one change at a time."),
    history: z.array(turn).max(40).optional(),
  }),
  z.object({ action: z.literal("apply"), campaignId, proposalId: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal("undo"), campaignId, changeId: z.string().trim().min(1).max(100) }),
]);
export type TrainRequest = z.infer<typeof trainRequest>;

const SHARED_TEXT = "That answer is shared by all the offers, so this changes it for every one of them.";

/**
 * The reply and the warning to show above a suggestion. Voizo flags a change that reaches every offer's agent
 * (`sharedAcrossOffers`) and also says it in the reply; its own sentence is shown when there is one, ours otherwise.
 */
export function sharedWarning(reply: string, proposal: TrainProposal | null): { text: string; warning: string | null } {
  const said = splitHeadsUp(reply);
  if (said.warning || !proposal?.sharedAcrossOffers) return said;
  return { text: said.text, warning: SHARED_TEXT };
}

/** One bubble of the training window, as far as the conversation history needs to know it. */
export interface ShownTurn {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  warning?: string | null;
  hasProposal?: boolean;
  state?: "saved" | "discarded" | "undone";
}

const OUTCOME: Record<string, string> = {
  saved: "(The operator saved this change: it is live.)",
  discarded: "(The operator discarded this suggestion: nothing changed.)",
  undone: "(The operator saved this change and then undid it: the script has the earlier wording again.)",
};

/**
 * The conversation so far as the trainer should hear it: error bubbles left out, the shared-answer warning put back
 * into the reply, and what happened to each suggestion said out loud. Without that the trainer built its next
 * suggestion on a change the operator had already undone (QA, 23 Nov 2026).
 */
export function historyTurns(turns: ShownTurn[]): TrainTurn[] {
  return turns
    .filter((t) => !t.error)
    .map((t) => {
      const said = t.warning ? `${t.text} Heads up: ${t.warning}` : t.text;
      const outcome = t.role === "assistant" && t.hasProposal ? (t.state ? OUTCOME[t.state] : "(Not saved yet.)") : "";
      return { role: t.role, text: outcome ? `${said} ${outcome}` : said };
    });
}

/** The last 10 turns that say something, each cut to 1,000 characters (what Voizo accepts as context). */
export function clipHistory(turns: TrainTurn[]): TrainTurn[] {
  return turns
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, MAX_TEXT) }))
    .filter((t) => t.text)
    .slice(-MAX_TURNS);
}

// A script line can hold two versions in template code: {% if playername != blank %}Hi {{playername}}…{% else %}Hey…{% endif %}.
const IF_BLOCK = /\{%-?\s*if\b[^%]*%\}((?:(?!\{%-?\s*if\b)[\s\S])*?)\{%-?\s*endif\s*-?%\}/;
const BRANCH = /\{%-?\s*(?:else|elsif\b[^%]*)\s*-?%\}/;
const MAX_VERSIONS = 4;

/** Each version of one script line as plain words (the {{tokens}} stay; the if / else template code goes). */
function versions(line: string): string[] {
  let out = [line];
  for (let pass = 0; pass < MAX_VERSIONS && out.some((v) => IF_BLOCK.test(v)); pass++) {
    out = out
      .flatMap((v) => {
        const m = IF_BLOCK.exec(v);
        if (!m) return [v];
        const branches = m[1].split(BRANCH);
        if (branches.length === 1) branches.push(""); // no "else": the other version says nothing there
        return branches.map((b) => v.slice(0, m.index) + b + v.slice(m.index + m[0].length));
      })
      .slice(0, MAX_VERSIONS);
  }
  const clean = out.map((v) => v.replace(/\{%[^%]*%\}/g, "").replace(/\s+([,.!?])/g, "$1").replace(/\s{2,}/g, " ").trim());
  return [...new Set(clean)];
}

/**
 * A before/after value as display lines; an emptied box reads as "(nothing said here)". A line with two versions
 * (with / without the person's name) shows one line per version, without the template code.
 */
export function asLines(v: string | string[]): string[] {
  const lines = (Array.isArray(v) ? v : [v]).flatMap(versions).filter(Boolean);
  return lines.length ? lines : ["(nothing said here)"];
}

/** One change as the window shows it: the same answer used in several parts of the call appears once. */
export interface TrainEditGroup {
  title: string;
  /** The parts of the call that say this same line (empty when it is said in one place). */
  places: string[];
  before: string | string[];
  after: string | string[];
}

/**
 * Voizo lists one edit per place a line is used ("Name check — "Owner asks who is calling."", "The pitch — …"), so a
 * standing answer arrives many times over. Group edits with the same before → after into one card.
 */
export function groupEdits(edits: TrainEdit[]): TrainEditGroup[] {
  const groups = new Map<string, { labels: string[]; before: string | string[]; after: string | string[] }>();
  for (const e of edits) {
    const key = JSON.stringify([e.before, e.after]);
    const g = groups.get(key) ?? { labels: [], before: e.before, after: e.after };
    if (!g.labels.includes(e.label)) g.labels.push(e.label);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ labels, before, after }) => {
    if (labels.length === 1) return { title: labels[0], places: [], before, after };
    const parts = labels.map((l) => {
      const i = l.indexOf(" — ");
      return i < 0 ? null : { place: l.slice(0, i).trim(), what: l.slice(i + 3).trim() };
    });
    const what = parts[0]?.what;
    if (what && parts.every((p) => p?.what === what)) {
      return { title: what.replace(/^"(.*)"$/, "$1"), places: [...new Set(parts.map((p) => p!.place))], before, after };
    }
    return { title: labels[0], places: labels.slice(1), before, after };
  });
}

/**
 * Voizo ends its reply with "Heads up: that answer is shared by all the offers…" when a change reaches every offer's
 * agent. Pull that sentence out so the window can show it as a warning. Wording it doesn't recognise stays in the text.
 */
export function splitHeadsUp(reply: string): { text: string; warning: string | null } {
  const m = /^([\s\S]*?)\s*\bHeads up:\s*([\s\S]+)$/i.exec(reply.trim());
  if (!m) return { text: reply.trim(), warning: null };
  const w = m[2].trim();
  return { text: m[1].trim(), warning: w.charAt(0).toUpperCase() + w.slice(1) };
}

const TEXT: Record<string, string> = {
  not_configured: "AI calling isn't switched on here (no Voizo key), so the agent can't be trained.",
  network_error: "Couldn't reach Voizo. Check the connection and try again.",
  http_404: "Training isn't switched on in Voizo yet. The Voizo team needs to turn it on first.",
  http_405: "Training isn't switched on in Voizo yet. The Voizo team needs to turn it on first.",
  unauthorized: "Voizo didn't accept our key. Ask the developer to check VOIZO_API_KEY.",
  http_401: "Voizo didn't accept our key. Ask the developer to check VOIZO_API_KEY.",
  unknown_campaign: "Voizo doesn't know this agent any more. Reload the page and pick it again.",
  stale_proposal:
    "That suggestion can't be saved any more: it was already saved, is over 30 minutes old, or the script changed since this suggestion. Ask again.",
  undo_conflict: "This change can't be undone on its own: it was already undone, or a newer change touched the same lines. Undo the newer change first.",
  ai_unavailable: "The AI that rewrites the script is unavailable right now. Try again in a minute.",
  rate_limited: "This agent has had a lot of training today. Try again tomorrow.",
  provision_failed: "Voizo couldn't update the live agent, so nothing was changed. Try again in a minute.",
  bad_response: "Voizo answered in a way we didn't expect. Try again; if it keeps happening, tell the developer.",
};

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/**
 * A plain sentence for a Voizo refusal. `bad_request` shows Voizo's own sentence (it names what was wrong); a stale
 * suggestion / undo conflict adds Voizo's plain detail (which part of the script moved); the daily limit is named.
 */
export function trainErrorText(code: string, voizoSentence?: string | null, extra?: { detail?: string | null; cap?: number | null }): string {
  if (code === "bad_request" && voizoSentence?.trim()) return voizoSentence.trim();
  if (code === "rate_limited" && extra?.cap) return `This agent has used its ${extra.cap} training requests for today. Try again tomorrow.`;
  const base = TEXT[code] ?? "Voizo couldn't do that right now. Try again in a minute.";
  const detail = extra?.detail?.trim();
  return (code === "stale_proposal" || code === "undo_conflict") && detail ? `${base} ${sentence(detail)}` : base;
}
