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
 *
 * Sets `leads.rebuild_started_at` before dispatch so the client can restore
 * the building spinner after a page navigation; cleared by the polling loop
 * on completion or by this route on trigger failure. The column is shared
 * with /regenerate — only one long-running pipeline can be in flight per
 * lead at a time (build needs no demo_url, regenerate needs one).
 */

import { buildLead } from "@/lib/pipeline/build-lead";
import { skipIfNotBuildable } from "@/lib/pipeline/build-gate";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";

const log = getLogger("api.leads.build");

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  // Gate: the website builder only runs for the five focus niches. Bail out
  // early (no Cloud Run spin-up, no spinner) when off-list. The lead stays
  // scraped/enriched for outreach.
  const skip = await skipIfNotBuildable(params.id);
  if (skip) {
    log.info({ lead_id: params.id, template_slug: skip.templateSlug }, "build.skipped_non_focus_niche");
    return ok({ id: params.id, status: "skipped", reason: skip.reason });
  }

  // Mark the build as in progress so a page refresh restores the spinner.
  // The dashboard auto-falls-out-of-spinner after the 5-min stale window in
  // LeadActions, so a crashed job can't leave the UI stuck forever.
  await getDb()
    .from("leads")
    .update({ rebuild_started_at: new Date().toISOString(), last_error: null })
    .eq("id", params.id);

  // Operator forces a fresh photo pick by passing ?refresh-photos=1.
  // Clears the cache columns so stage-3 re-runs the Vision call instead
  // of reusing the prior selection. Useful after Improve adds new photos.
  const refreshPhotos = new URL(req.url).searchParams.get("refresh-photos") === "1";
  if (refreshPhotos) {
    await getDb()
      .from("leads")
      .update({ hero_photo_url: null, photo_order_json: null, photos_picked_at: null })
      .eq("id", params.id);
  }

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
      await getDb().from("leads").update({ rebuild_started_at: null }).eq("id", params.id);
      log.error({ lead_id: params.id, err: String(err) }, "cloud-run.trigger_failed");
      return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
    }
  }

  // Local-dev path: in-process invocation. This runs ~30-90s and only works
  // outside Vercel (filesystem + execution time).
  buildLead(params.id)
    .catch((err) => log.error({ lead_id: params.id, err: String(err) }, "build.failed"))
    .finally(async () => {
      await getDb().from("leads").update({ rebuild_started_at: null }).eq("id", params.id);
    });
  return ok({ id: params.id, status: "building", runner: "local" }, { status: 202 });
});
