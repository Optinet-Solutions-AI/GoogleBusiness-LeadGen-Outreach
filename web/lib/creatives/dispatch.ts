/**
 * dispatch.ts — run a creative/plan job on Cloud Run, or in-process when Cloud Run is not configured.
 *
 * Inputs:  the request (for the Vercel OIDC token), job env vars, a local runner, an optional release hook
 * Outputs: a 202 { status, runner } response, or 502 when the Cloud Run trigger fails (release() is called first)
 * Used by: plans/[pid]/{concepts,generate}, creatives/[cid]/{versions,regenerate} routes
 */
import "@/lib/server-guard";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";

const log = getLogger("api.creatives.dispatch");
const JOB_TIMEOUT_S = 35 * 60;

export async function dispatchJob(
  req: Request,
  opts: {
    vars: Record<string, string>;
    status: string;
    local: () => Promise<unknown>;
    /** Undo a route-side claim when the job could not be started. */
    release?: () => Promise<void>;
    extra?: Record<string, unknown>;
  },
): Promise<Response> {
  if (isCloudRunConfigured()) {
    const oidcToken = req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
    try {
      const op = await triggerJob(opts.vars, { oidcToken, timeoutSeconds: JOB_TIMEOUT_S });
      return ok(
        { ...opts.extra, status: opts.status, runner: "cloud-run", operation: op.operationName },
        { status: 202 },
      );
    } catch (err) {
      await opts.release?.().catch(() => undefined);
      log.error({ vars: opts.vars, err: String(err) }, "cloud-run.trigger_failed");
      return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
    }
  }
  // Local-dev fallback: in-process, fire-and-forget (the run claims/clears its own flags).
  opts
    .local()
    .catch((err) => log.error({ vars: opts.vars, err: String(err) }, "local.run_failed"));
  return ok({ ...opts.extra, status: opts.status, runner: "local" }, { status: 202 });
}
