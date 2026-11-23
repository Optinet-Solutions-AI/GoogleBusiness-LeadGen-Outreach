/**
 * calls/train-agent-view.ts — "Train a voice agent": the request the window sends, the shapes it shows, and the plain
 * sentence for every way Voizo can say no. Pure (no db, no network), safe to import in client components.
 *
 * Inputs:  the POST body of /api/voice-training; a Voizo error code; a script line or list of lines
 * Outputs: trainRequest (zod) · trainErrorText(code) · asLines(before/after) · clipHistory(turns)
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

/** The last 10 turns that say something, each cut to 1,000 characters (what Voizo accepts as context). */
export function clipHistory(turns: TrainTurn[]): TrainTurn[] {
  return turns
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, MAX_TEXT) }))
    .filter((t) => t.text)
    .slice(-MAX_TURNS);
}

/** A before/after value as display lines; an emptied box reads as "(nothing said here)". */
export function asLines(v: string | string[]): string[] {
  const lines = (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines : ["(nothing said here)"];
}

const TEXT: Record<string, string> = {
  not_configured: "AI calling isn't switched on here (no Voizo key), so the agent can't be trained.",
  network_error: "Couldn't reach Voizo. Check the connection and try again.",
  http_404: "Training isn't switched on in Voizo yet. The Voizo team needs to turn it on first.",
  http_405: "Training isn't switched on in Voizo yet. The Voizo team needs to turn it on first.",
  unauthorized: "Voizo didn't accept our key. Ask the developer to check VOIZO_API_KEY.",
  http_401: "Voizo didn't accept our key. Ask the developer to check VOIZO_API_KEY.",
  unknown_campaign: "Voizo doesn't know this agent any more. Reload the page and pick it again.",
  stale_proposal: "The script changed since this suggestion, so it wasn't saved. Ask again.",
  undo_conflict: "A newer change touched the same lines, so this one can't be undone by itself. Undo the newer change first.",
  ai_unavailable: "The AI that rewrites the script is unavailable right now. Try again in a minute.",
  rate_limited: "This agent has had a lot of training today. Try again tomorrow.",
  bad_response: "Voizo answered in a way we didn't expect. Try again; if it keeps happening, tell the developer.",
};

/** A plain sentence for a Voizo refusal. `bad_request` shows Voizo's own sentence (it names what was wrong). */
export function trainErrorText(code: string, voizoSentence?: string | null): string {
  if (code === "bad_request" && voizoSentence?.trim()) return voizoSentence.trim();
  return TEXT[code] ?? "Voizo couldn't do that right now. Try again in a minute.";
}
