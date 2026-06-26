/**
 * build-queue.ts — Build demo sites for many leads concurrently (worker pool).
 *
 * Inputs:  a list of lead ids + concurrency
 * Outputs: { built, skipped, failed, results } and the side effects of buildLead
 *          per lead (enrich → generate → deploy → screenshot).
 * Used by: the Cloud Run job MODE=build-queue + /api/leads/build-bulk.
 *
 * Mirrors runQueuedBatches: a capped worker pool drains the list, each lead is
 * isolated (one failure doesn't stop the rest), and non-buildable niches are
 * skipped (they stay available for outreach). Concurrency is LOW by default
 * because each build runs Playwright/Chromium for the screenshot, which is
 * memory-heavy on the 1 GiB Cloud Run job.
 */

import { getDb } from "@/lib/db";
import { buildLead } from "@/lib/pipeline/build-lead";
import { skipIfNotBuildable } from "@/lib/pipeline/build-gate";
import { getLogger } from "@/lib/logger";

const log = getLogger("build-queue");

export interface QueuedBuildResult {
  lead_id: string;
  status: "built" | "skipped" | "failed";
  reason?: string;
  error?: string;
}

export async function runQueuedBuilds(opts: {
  leadIds: string[];
  concurrency?: number;
}): Promise<{ built: number; skipped: number; failed: number; results: QueuedBuildResult[] }> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 2, 4));
  const queue = [...new Set(opts.leadIds)];
  const db = getDb();

  if (queue.length === 0) {
    log.info("runQueuedBuilds.empty");
    return { built: 0, skipped: 0, failed: 0, results: [] };
  }
  log.info({ count: queue.length, concurrency }, "runQueuedBuilds.start");

  const results: QueuedBuildResult[] = [];
  const clearMarker = (id: string) =>
    db.from("leads").update({ rebuild_started_at: null }).eq("id", id);

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      try {
        const skip = await skipIfNotBuildable(id);
        if (skip) {
          results.push({ lead_id: id, status: "skipped", reason: skip.reason });
          await clearMarker(id);
          continue;
        }
        await buildLead(id);
        results.push({ lead_id: id, status: "built" });
      } catch (err) {
        const msg = String(err).slice(0, 300);
        results.push({ lead_id: id, status: "failed", error: msg });
        await db.from("leads").update({ last_error: msg }).eq("id", id);
        log.warn({ lead_id: id, err: msg }, "runQueuedBuilds.lead_failed");
      } finally {
        await clearMarker(id);
      }
    }
  });
  await Promise.all(workers);

  const summary = {
    built: results.filter((r) => r.status === "built").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
  log.info({ ...summary, results: undefined }, "runQueuedBuilds.done");
  return summary;
}
