/**
 * reap-stuck.ts — watchdog that marks orphaned "running" batches as failed.
 *
 * Inputs:  batch rows (status, heartbeat_at, updated_at, created_at)
 * Outputs: flips truly-dead 'running' batches → 'failed' with a last_error note
 * Used by: app/api/batches/[id]/route.ts (poller), the batch detail + list
 *          pages (on load). Safe to call often — it only writes when a row is
 *          past the stale threshold.
 *
 * Why this exists: a scrape runs in a separate process (Cloud Run job) or a
 * Vercel function. If that process dies mid-flight it never writes the final
 * done/failed status, so the row hangs at 'running' forever. While alive, the
 * runner bumps heartbeat_at every ~15s (see orchestrator.runBatch). A missing
 * heartbeat for longer than STALE_MS means the process is gone → reap it.
 *
 * Correctness: the heartbeat is driven by a timer on the runner's event loop,
 * so it keeps firing through every phase (scrape poll, enrichment, upsert) as
 * long as the process lives. It stops ONLY when the process dies. That's why
 * we can reap on a short timeout without ever killing a batch that is still
 * genuinely working.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../db";
import { getLogger } from "../logger";

const log = getLogger("reap-stuck");

/** How long a 'running' batch may go without a heartbeat before it's presumed
 *  dead. Comfortably larger than the runner's 15s heartbeat interval, so an
 *  event-loop stall or GC pause can't trigger a false reap. */
export const STALE_MS = 3 * 60 * 1000; // 3 minutes

export interface ReapableBatch {
  id: string;
  status: string;
  heartbeat_at: string | null;
  updated_at: string | null;
  created_at: string | null;
}

/**
 * Pure decision: is this batch an orphaned 'running' row?
 *
 * Only 'running' batches are candidates. Liveness is measured from the most
 * recent signal we have — heartbeat_at if present, else the row's last write
 * (updated_at → created_at). If we have NO timestamp at all we do NOT reap
 * (fail safe: never kill a batch we can't reason about).
 */
export function isBatchStuck(batch: ReapableBatch, now: number, staleMs: number = STALE_MS): boolean {
  if (batch.status !== "running") return false;
  const ref = batch.heartbeat_at ?? batch.updated_at ?? batch.created_at;
  if (!ref) return false;
  const refMs = new Date(ref).getTime();
  if (Number.isNaN(refMs)) return false;
  return now - refMs > staleMs;
}

/**
 * Reap orphaned running batches. Pass an `id` to check a single batch (the
 * common case — the poller / detail page), or omit it to sweep all running
 * batches (the list page).
 *
 * Returns the ids that were reaped. The status flip is guarded on
 * status='running' so it can't clobber a job that finished in the meantime,
 * and if the process is somehow still alive its next heartbeat/final write
 * simply wins (all writes are idempotent).
 */
export async function reapStuckBatches(
  opts: { id?: string; now?: number; db?: SupabaseClient } = {},
): Promise<string[]> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();

  let query = db
    .from("batches")
    .select("id,status,heartbeat_at,updated_at,created_at")
    .eq("status", "running");
  if (opts.id) query = query.eq("id", opts.id);

  const { data, error } = await query;
  if (error) {
    log.warn({ err: error.message }, "reap.query_failed");
    return [];
  }

  const stuck = (data ?? []).filter((b) => isBatchStuck(b as ReapableBatch, now));
  const reaped: string[] = [];
  for (const b of stuck) {
    const { data: updated } = await db
      .from("batches")
      .update({
        status: "failed",
        last_error:
          "Scrape process died before finishing (no heartbeat). Auto-marked failed by the watchdog — click Re-run to retry.",
      })
      .eq("id", b.id)
      .eq("status", "running") // guard: don't overwrite a concurrent done/failed
      .select("id");
    if (updated && updated.length) {
      reaped.push(b.id);
      log.warn({ batch_id: b.id }, "reap.marked_failed");
    }
  }
  return reaped;
}
