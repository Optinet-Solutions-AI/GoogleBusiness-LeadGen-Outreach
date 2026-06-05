/**
 * api/verify/route.ts — POST: trigger the Cloud Run job in MODE=verify.
 * Kicks off a full-table email verification pass without tying up a Vercel
 * function. The same job image used for batch scrape dispatches on MODE.
 *
 * Inputs:  none (no body required)
 * Outputs: 202 { status: "running", runner: "cloud-run", operation } on success;
 *          503 when Cloud Run is not configured (local dev / missing GCP vars).
 * Used by: operator dashboard "Verify all emails" button
 */

import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = getLogger("api.verify");

export const POST = withApi(async (req) => {
  if (!isCloudRunConfigured()) {
    return fail(
      "Batch verification runs via the Cloud Run job (MODE=verify) or `npm run verify:leads`. " +
        "GCP env vars (GCP_PROJECT_ID, CLOUD_RUN_JOB_NAME, GCP_WORKLOAD_IDENTITY_PROVIDER, " +
        "GCP_SERVICE_ACCOUNT_EMAIL) are not configured.",
      503,
    );
  }

  // Pull the Vercel OIDC token from the request header (production) or env
  // fallback (dev) — same pattern as the batches run route.
  const oidcToken =
    req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;

  try {
    const op = await triggerJob({ MODE: "verify" }, { oidcToken });
    log.info({ operation: op.operationName }, "verify.job_triggered");
    return ok({ status: "running", runner: "cloud-run", operation: op.operationName }, { status: 202 });
  } catch (err) {
    log.error({ err: String(err) }, "verify.trigger_failed");
    return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
  }
});
