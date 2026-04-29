/**
 * api/batches/[id]/run/route.ts — Trigger stage 1 (scrape) for a batch.
 *
 * POST /api/batches/:id/run
 *   → Returns 202 immediately ("running"). The scrape continues in the
 *     background via Vercel's `waitUntil` — survives client disconnect,
 *     so the user can close the modal without the function dying.
 *
 * The dashboard's batch detail page polls /api/batches/:id every 3s while
 * status='running' to refresh state.
 *
 * For batches > 60s on Vercel: run from the CLI instead:
 *   npm run --prefix web run:batch -- <batch_id>
 */

import { waitUntil } from "@vercel/functions";
import { runBatch } from "@/lib/pipeline/orchestrator";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";

const log = getLogger("api.batch.run");

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  // Schedule scrape in the background — keeps running past the response.
  waitUntil(
    runBatch(params.id).catch(async (err) => {
      log.error({ batch_id: params.id, err: String(err) }, "run.failed");
      // Defensive: if runBatch threw before its own catch could flip
      // status='failed', do it here so the dashboard never shows a zombie.
      try {
        await getDb()
          .from("batches")
          .update({ status: "failed" })
          .eq("id", params.id);
      } catch {
        /* swallow — already in error path */
      }
    }),
  );

  return ok({ id: params.id, status: "running" }, { status: 202 });
});

export const maxDuration = 60;
