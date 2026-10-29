/**
 * api/clients/[id]/brain/build/route.ts — Operator clicks "Build brand brain" on a client.
 *
 * POST /api/clients/:id/brain/build
 *   - Validates the client has at least one source, sets clients.brain_started_at.
 *   - Cloud Run configured: triggers the job with MODE=brand-brain CLIENT_ID=:id.
 *   - Local dev fallback: fire-and-forget runBrandBrainBuild() in-process.
 *
 * Inputs:  params.id
 * Outputs: 202 { id, status: "building", runner }; 400 when no sources; 502 when the trigger fails
 * Used by: client detail page (polls GET /api/clients/:id while brain_started_at is set)
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";
import { getClient } from "@/lib/clients/clients";
import { listSources } from "@/lib/clients/sources";
import { assertBuildable, runBrandBrainBuild } from "@/lib/clients/build-brain";

const log = getLogger("api.clients.brain.build");
/** A brain_started_at older than this is a crashed job, not a running one. */
const STALE_MS = 20 * 60_000;

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const client = await getClient(params.id);
  if (!client) return fail("client not found", 404);

  try {
    assertBuildable(await listSources(params.id));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 400);
  }

  // Claim the in-progress flag atomically: a second click (or a stale-free flag younger than
  // STALE_MS) must not start a second paid job.
  const now = Date.now();
  const cutoff = new Date(now - STALE_MS).toISOString();
  const { data: claimed, error: claimErr } = await getDb()
    .from("clients")
    .update({ brain_started_at: new Date(now).toISOString() })
    .eq("id", params.id)
    .or(`brain_started_at.is.null,brain_started_at.lt.${cutoff}`)
    .select("id");
  if (claimErr) return fail(`could not start build: ${claimErr.message}`, 500);
  if (!claimed || claimed.length === 0) return fail("A build is already running.", 409);

  if (isCloudRunConfigured()) {
    const oidcToken = req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
    try {
      const op = await triggerJob({ MODE: "brand-brain", CLIENT_ID: params.id }, { oidcToken });
      return ok(
        { id: params.id, status: "building", runner: "cloud-run", operation: op.operationName },
        { status: 202 },
      );
    } catch (err) {
      await getDb().from("clients").update({ brain_started_at: null }).eq("id", params.id);
      log.error({ client_id: params.id, err: String(err) }, "cloud-run.trigger_failed");
      return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
    }
  }

  // Local-dev path: in-process. runBrandBrainBuild clears brain_started_at itself;
  // the finally is a safety net for failures before it starts.
  runBrandBrainBuild(params.id)
    .catch((err) => log.error({ client_id: params.id, err: String(err) }, "brain.build.failed"))
    .finally(async () => {
      await getDb().from("clients").update({ brain_started_at: null }).eq("id", params.id);
    });
  return ok({ id: params.id, status: "building", runner: "local" }, { status: 202 });
});
