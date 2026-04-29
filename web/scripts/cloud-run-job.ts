/**
 * scripts/cloud-run-job.ts — Entrypoint for the Cloud Run Job container.
 *
 * Inputs:  process.env.BATCH_ID (required, set by the Vercel trigger via
 *          containerOverrides when starting the job execution)
 * Outputs: runs the full orchestrator against that batch_id, exits 0 on
 *          success / 1 on failure (Cloud Run records the exit status).
 * Used by: the deployed Cloud Run Job `lead-batch-runner` (see Dockerfile).
 *
 * Why a separate entrypoint from run-batch.ts: Cloud Run Jobs pass input
 * via env vars, not argv, and we want this to be a strict batch_id lookup
 * (no create-on-the-fly path that the CLI offers).
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
// .env at repo root if it happens to be there (local docker run); in
// production Cloud Run injects env vars from Secret Manager directly.
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

import { runBatch } from "@/lib/pipeline/orchestrator";
import { getLogger } from "@/lib/logger";

const log = getLogger("cloud-run-job");

async function main() {
  const batchId = process.env.BATCH_ID;
  if (!batchId) {
    log.error("missing BATCH_ID env var");
    process.exit(2);
  }

  log.info({ batch_id: batchId }, "job.start");
  const counters = await runBatch(batchId);
  log.info({ batch_id: batchId, ...counters }, "job.done");
}

main().catch((err) => {
  log.error({ err: String(err), stack: err?.stack }, "job.failed");
  process.exit(1);
});
