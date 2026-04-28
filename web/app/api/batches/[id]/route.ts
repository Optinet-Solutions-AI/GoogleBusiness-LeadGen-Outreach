/**
 * api/batches/[id]/route.ts — Batch detail + per-stage lead counts.
 *
 * GET /api/batches/:id → { batch, stage_counts: { stage: count } }
 */

import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const db = getDb();
  const { data: batch, error } = await db
    .from("batches")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error || !batch) return fail("batch not found", 404);

  const { data: counts } = await db.rpc("count_leads_by_stage", { p_batch_id: params.id });
  return ok({ batch, stage_counts: counts ?? [] });
}
