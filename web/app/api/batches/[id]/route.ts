/**
 * api/batches/[id]/route.ts — Batch detail + per-stage lead counts.
 *
 * GET /api/batches/:id → { batch, stage_counts: { stage: count } }
 */

import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { reapStuckBatches } from "@/lib/pipeline/reap-stuck";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const db = getDb();
  // Self-heal: if this batch's runner died mid-scrape, flip it to 'failed'
  // before returning so the poller sees the true state (never a phantom
  // 'running'). No-op unless the heartbeat is stale.
  await reapStuckBatches({ id: params.id }).catch(() => {});
  const { data: batch, error } = await db
    .from("batches")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error || !batch) return fail("batch not found", 404);

  const { data: counts } = await db.rpc("count_leads_by_stage", { p_batch_id: params.id });
  return ok({ batch, stage_counts: counts ?? [] });
}
