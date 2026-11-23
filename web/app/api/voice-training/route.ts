/**
 * api/voice-training/route.ts — "Train a voice agent": ask it to change its wording, save or undo the change.
 *
 * Inputs:  GET  (no query)            → which offers' agents can be trained
 *          GET  ?campaignId=<id>      → that agent's recent saved changes
 *          POST { action: "ask", campaignId, message, history? } | { action: "apply", campaignId, proposalId }
 *               | { action: "undo", campaignId, changeId }
 * Outputs: GET  { configured, agents, note? } | { changes }
 *          POST ask → { reply, proposal | null } (nothing changes) · apply → { changeId } · undo → { undone }
 *               409 / 503 with a plain sentence when Voizo says no
 * Used by: components/voice/TrainAgentModal.tsx
 *
 * Thin: zod → lib/calls/train-agent.ts → Voizo. The script lives in Voizo; nothing is stored here.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { trainRequest } from "@/lib/calls/train-agent-view";
import { askTrainer, listTrainable, recentChanges, saveTraining, undoChange } from "@/lib/calls/train-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// "ask" waits for one AI rewrite on Voizo's side (up to ~50 s).
export const maxDuration = 60;

export const GET = withApi(async (req) => {
  const campaignId = new URL(req.url).searchParams.get("campaignId")?.trim();
  if (!campaignId) return ok(await listTrainable());
  if (campaignId.length > 100) return fail("Unknown agent", 400);
  const r = await recentChanges(campaignId);
  return r.ok ? ok(r.data) : fail(r.message, r.status);
});

export const POST = withApi(async (req) => {
  const parsed = trainRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const b = parsed.data;
  const r =
    b.action === "ask"
      ? await askTrainer(b.campaignId, b.message, b.history ?? [])
      : b.action === "apply"
        ? await saveTraining(b.campaignId, b.proposalId)
        : await undoChange(b.campaignId, b.changeId);
  return r.ok ? ok(r.data) : fail(r.message, r.status);
});
