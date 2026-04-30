/**
 * api/batches/[id]/run/route.ts — Trigger stage 1 (scrape) for a batch.
 *
 * POST /api/batches/:id/run
 *   → Returns 202 immediately ("running"). The actual scrape runs on
 *     Cloud Run Jobs (no 60s function cap), reachable from the dashboard
 *     because the route handler hands off via the Run REST API.
 *
 * Fallback path: if GCP env vars aren't set yet (local dev, or Vercel
 * before secrets are wired), drops back to inline `waitUntil` so the
 * dashboard still works for small (<60s) batches.
 *
 * The dashboard's batch detail page polls /api/batches/:id every 3s while
 * status='running' to refresh state — this is unchanged regardless of
 * which execution path runs.
 */

import { waitUntil } from "@vercel/functions";
import { runBatch } from "@/lib/pipeline/orchestrator";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";
import { isCloudRunConfigured, triggerBatchJob } from "@/lib/services/cloud-run";

const log = getLogger("api.batch.run");

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  if (isCloudRunConfigured()) {
    // In production Vercel injects the OIDC token via the
    // `x-vercel-oidc-token` request header (NOT the VERCEL_OIDC_TOKEN env
    // var, which is the dev-only fallback). Pull from header first, then
    // env var, and pass it down — cloud-run.ts can't see the request.
    const oidcToken =
      req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;

    try {
      const op = await triggerBatchJob(params.id, { oidcToken });
      // Mark queued → running here so the UI flips state without waiting
      // for the job to start. The job itself also writes "running" but
      // that's idempotent.
      await getDb().from("batches").update({ status: "running" }).eq("id", params.id);
      return ok({ id: params.id, status: "running", runner: "cloud-run", operation: op.operationName }, { status: 202 });
    } catch (err) {
      log.error({ batch_id: params.id, err: String(err) }, "cloud-run.trigger_failed");
      // Don't fall back silently — surface the error so the operator can
      // fix the GCP setup. The DB row stays at its previous status.
      return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
    }
  }

  // Fallback — inline scrape via waitUntil. Capped at ~60s by Vercel.
  log.warn({ batch_id: params.id }, "cloud-run.unconfigured_using_waituntil");
  waitUntil(
    runBatch(params.id).catch(async (err) => {
      log.error({ batch_id: params.id, err: String(err) }, "run.failed");
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

  return ok({ id: params.id, status: "running", runner: "vercel" }, { status: 202 });
});

export const maxDuration = 60;
