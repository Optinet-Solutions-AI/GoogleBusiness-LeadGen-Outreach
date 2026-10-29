/**
 * batch-control.ts — Pause / resume / cancel a scraping batch.
 *
 * Inputs:  batch id + action ("pause" | "resume" | "cancel")
 * Outputs: batches.status / stop_requested updates; { status, stop_requested, run } (run = caller should start the run)
 * Used by: app/api/batches/[id]/control/route.ts
 *
 * Queued and paused batches change at once. A running batch gets a request (stop_requested) that the runner
 * reads with its heartbeat: Cancel aborts the paid scrape and keeps what it found; Pause lets the scrape finish,
 * saves the leads and holds before enrichment. Resume puts a paused batch back in the queue — the runner then
 * enriches only (resume_from='enrich') or, if it was paused before starting, scrapes as normal.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const log = getLogger("batch-control");

export type BatchAction = "pause" | "resume" | "cancel";

export type ControlPatch = {
  status?: "queued" | "paused" | "cancelled";
  stop_requested?: "pause" | "cancel" | null;
  resume_from?: null;
};

export class BatchControlError extends Error {}

/** What an action does to a batch in `status`; throws when the action does not apply. Pure. */
export function controlPatch(status: string, action: BatchAction): { patch: ControlPatch; run: boolean } {
  if (action === "pause") {
    if (status === "queued") return { patch: { status: "paused" }, run: false };
    if (status === "running") return { patch: { stop_requested: "pause" }, run: false };
  }
  if (action === "cancel") {
    if (status === "queued" || status === "paused") {
      return { patch: { status: "cancelled", stop_requested: null, resume_from: null }, run: false };
    }
    if (status === "running") return { patch: { stop_requested: "cancel" }, run: false };
  }
  if (action === "resume" && status === "paused") return { patch: { status: "queued" }, run: true };
  throw new BatchControlError(`can't ${action} a ${status} batch`);
}

export async function controlBatch(
  batchId: string,
  action: BatchAction,
): Promise<{ status: string; stop_requested: string | null; run: boolean }> {
  const db = getDb();
  // Two tries: the queue runner may claim a queued batch (queued → running) between our read and write.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: batch, error } = await db.from("batches").select("id,status").eq("id", batchId).maybeSingle();
    if (error) throw new Error(`batch read failed: ${error.message}`);
    if (!batch) throw new BatchControlError("batch not found");
    const status = (batch as { status: string }).status;
    const { patch, run } = controlPatch(status, action);
    // Only applies if the status is still the one we decided on.
    const { data: updated, error: uErr } = await db
      .from("batches")
      .update(patch)
      .eq("id", batchId)
      .eq("status", status)
      .select("status,stop_requested");
    if (uErr) throw new Error(`batch update failed: ${uErr.message}`);
    const row = (updated ?? [])[0] as { status: string; stop_requested: string | null } | undefined;
    if (row) {
      log.info({ batch_id: batchId, action, from: status, to: row.status, stop_requested: row.stop_requested }, "batch_control.done");
      return { ...row, run };
    }
  }
  throw new BatchControlError("the batch changed while updating; try again");
}
