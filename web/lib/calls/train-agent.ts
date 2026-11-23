/**
 * calls/train-agent.ts — "Train a voice agent": pass the operator's plain instruction to Voizo, save or undo what
 * it proposes, and list which offers' scripts can be trained.
 *
 * Inputs:  a Voizo campaign id (one offer's script), the operator's words + the recent turns, a proposal / change id
 * Outputs: { ok, data } | { ok: false, status, message } with a plain sentence for every refusal. Nothing is stored
 *          here: the script and its change history live in Voizo.
 * Used by: app/api/voice-training/route.ts
 *
 * Asking only PROPOSES (one OpenAI call on Voizo's side). The script changes when a proposal is saved; every saved
 * change can be undone. Until Voizo ships the endpoints every call answers "not switched on in Voizo yet".
 */
import "@/lib/server-guard";
import { getLogger } from "@/lib/logger";
import { SERVICES } from "@/lib/email/service-templates";
import {
  applyTraining,
  isVoizoConfigured,
  listScripts,
  listTrainingChanges,
  trainScript,
  undoTraining,
} from "@/lib/services/voizo";
import { clipHistory, trainErrorText, type TrainChange, type TrainProposal, type TrainTurn, type TrainableAgent } from "./train-agent-view";

const log = getLogger("train-agent");

export type TrainResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export interface TrainDeps {
  configured: () => boolean;
  scripts: typeof listScripts;
  train: typeof trainScript;
  apply: typeof applyTraining;
  undo: typeof undoTraining;
  changes: typeof listTrainingChanges;
}
const defaultDeps: TrainDeps = {
  configured: isVoizoConfigured,
  scripts: listScripts,
  train: trainScript,
  apply: applyTraining,
  undo: undoTraining,
  changes: listTrainingChanges,
};

/** Our HTTP status for a Voizo refusal: 409 for "can't right now, state changed", 503 for "not available". */
function refusal(where: string, r: { status: number; code: string; error: string }): { ok: false; status: number; message: string } {
  log.warn({ where, status: r.status, code: r.code }, "train_agent.refused");
  const conflict = r.code === "stale_proposal" || r.code === "undo_conflict" || r.code === "bad_request" || r.code === "rate_limited";
  return { ok: false, status: conflict ? 409 : 503, message: trainErrorText(r.code, r.error) };
}

const NOT_ON = "AI calling isn't switched on here (no Voizo key), so the agent can't be trained.";

/** The offers' scripts that can be trained (Voizo's list; our offer names where we have one). */
export async function listTrainable(deps: TrainDeps = defaultDeps): Promise<{ configured: boolean; agents: TrainableAgent[]; note?: string }> {
  if (!deps.configured()) return { configured: false, agents: [], note: NOT_ON };
  const r = await deps.scripts();
  if (!r.ok) return { configured: true, agents: [], note: trainErrorText(r.code, r.error) };
  const agents = r.data.scripts
    .filter((s) => s.offerKey)
    .map((s) => ({
      campaignId: s.campaignId,
      offerKey: s.offerKey ?? null,
      label: SERVICES.find((x) => x.key === s.offerKey)?.label ?? s.name ?? s.offerKey ?? "Voice agent",
    }));
  return { configured: true, agents };
}

export async function askTrainer(
  campaignId: string,
  message: string,
  history: TrainTurn[],
  deps: TrainDeps = defaultDeps,
): Promise<TrainResult<{ reply: string; proposal: TrainProposal | null }>> {
  const r = await deps.train(campaignId, { instruction: message.trim(), history: clipHistory(history), actor: "lead-gen operator" });
  if (!r.ok) return refusal("ask", r);
  log.info({ campaign_id: campaignId, proposed: r.data.proposal?.edits.length ?? 0 }, "train_agent.asked");
  return { ok: true, data: { reply: r.data.reply, proposal: r.data.proposal ?? null } };
}

export async function saveTraining(campaignId: string, proposalId: string, deps: TrainDeps = defaultDeps): Promise<TrainResult<{ changeId: string }>> {
  const r = await deps.apply(campaignId, proposalId);
  if (!r.ok) return refusal("apply", r);
  log.info({ campaign_id: campaignId, change_id: r.data.changeId }, "train_agent.saved");
  return { ok: true, data: { changeId: r.data.changeId } };
}

export async function undoChange(campaignId: string, changeId: string, deps: TrainDeps = defaultDeps): Promise<TrainResult<{ undone: boolean }>> {
  const r = await deps.undo(campaignId, changeId);
  if (!r.ok) return refusal("undo", r);
  log.info({ campaign_id: campaignId, change_id: changeId }, "train_agent.undone");
  return { ok: true, data: { undone: r.data.undone } };
}

/** Recent saved changes. If Voizo can't list them the window still works: an empty list, not an error. */
export async function recentChanges(campaignId: string, deps: TrainDeps = defaultDeps): Promise<TrainResult<{ changes: TrainChange[] }>> {
  const r = await deps.changes(campaignId);
  if (!r.ok) {
    log.warn({ campaign_id: campaignId, code: r.code }, "train_agent.history_unavailable");
    return { ok: true, data: { changes: [] } };
  }
  return { ok: true, data: { changes: r.data.changes } };
}
