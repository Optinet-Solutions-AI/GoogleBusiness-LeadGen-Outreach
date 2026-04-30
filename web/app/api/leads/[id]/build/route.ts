/**
 * api/leads/[id]/build/route.ts — Operator clicks "Build website" on a lead.
 *
 * POST /api/leads/:id/build
 *   - When Cloud Run is configured: triggers a Cloud Run Job with
 *     MODE=build LEAD_ID=:id (runs stages 2 → 3 → 4: enrich, generate, deploy).
 *   - Local dev fallback: fire-and-forget invokes buildLead() in-process.
 *
 * Stage 3 calls `npm run build` inside templates/<slug>/ which needs a
 * writable filesystem and minutes of execution — neither available on
 * Vercel's serverless functions. The Cloud Run image bakes the templates
 * (with deps pre-installed) into the container, so the build runs there.
 */

import { buildLead } from "@/lib/pipeline/build-lead";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";

const log = getLogger("api.leads.build");

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  if (isCloudRunConfigured()) {
    const oidcToken =
      req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
    try {
      const op = await triggerJob(
        { MODE: "build", LEAD_ID: params.id },
        { oidcToken },
      );
      return ok(
        { id: params.id, status: "building", runner: "cloud-run", operation: op.operationName },
        { status: 202 },
      );
    } catch (err) {
      log.error({ lead_id: params.id, err: String(err) }, "cloud-run.trigger_failed");
      return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
    }
  }

  // Local-dev path: in-process invocation. This runs ~30-90s and only works
  // outside Vercel (filesystem + execution time).
  buildLead(params.id).catch((err) =>
    log.error({ lead_id: params.id, err: String(err) }, "build.failed"),
  );
  return ok({ id: params.id, status: "building", runner: "local" }, { status: 202 });
});
