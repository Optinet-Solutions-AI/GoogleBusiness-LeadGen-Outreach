/**
 * api/batches/[id]/run/route.ts — Re-trigger the pipeline for an existing batch.
 *
 * POST /api/batches/:id/run
 *   → fires runBatch() in the background; returns 202 immediately
 *
 * NOTE: serverless function timeouts are short. For batches that take >60s,
 * prefer the CLI: `npm run --prefix web run:batch <id>`. In production, wire
 * Inngest / a queue rather than the in-process trigger here.
 */

import { runBatch } from "@/lib/pipeline/orchestrator";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/response";

const log = getLogger("api.batch.run");

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  // Fire-and-forget: don't await. Errors are logged + persisted on lead rows.
  runBatch(params.id).catch((err) =>
    log.error({ batch_id: params.id, err: String(err) }, "run.failed"),
  );
  return ok({ id: params.id, status: "queued" }, { status: 202 });
}
