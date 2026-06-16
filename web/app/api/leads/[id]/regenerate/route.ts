/**
 * api/leads/[id]/regenerate/route.ts — Re-run a lead from a given stage.
 *
 * POST /api/leads/:id/regenerate  body: { from_stage: 'enrich'|'generate'|'deploy'|'outreach' }
 *
 * Long-running. Dispatches to Cloud Run when configured (MODE=regenerate
 * LEAD_ID=… FROM_STAGE=…), falls back to in-process for local dev.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import * as stage2 from "@/lib/pipeline/stage-2-enrich";
import * as stage3 from "@/lib/pipeline/stage-3-generate";
import * as stage4 from "@/lib/pipeline/stage-4-deploy";
import * as stage5 from "@/lib/pipeline/stage-5-outreach";
import { skipIfNotBuildable } from "@/lib/pipeline/build-gate";
import { fail, ok } from "@/lib/response";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";

const log = getLogger("api.leads.regenerate");

const Body = z.object({
  from_stage: z.enum(["enrich", "generate", "deploy", "outreach"]),
});

const ORDER = ["enrich", "generate", "deploy", "outreach"] as const;
type Step = (typeof ORDER)[number];

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  // Gate: rebuilds run only for the focus niches (no Cloud Run spin-up, no
  // spinner for off-list leads). Structurally rare — off-list leads have no
  // demo to rebuild — but enforce it here too for direct API calls.
  const skip = await skipIfNotBuildable(params.id);
  if (skip) {
    log.info({ lead_id: params.id, template_slug: skip.templateSlug }, "regenerate.skipped_non_focus_niche");
    return ok({ id: params.id, status: "skipped", reason: skip.reason });
  }

  // Mark the rebuild as in progress so a page refresh can restore the
  // spinner state. Cleared by the client polling loop on success/failure;
  // the dashboard auto-falls-out-of-spinner if the timestamp goes stale
  // (>5 min old), so a crashed job can't leave the UI stuck forever.
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

  // ?refresh-socials=1 forces stage-2 to re-detect the FB/IG URL + re-extract
  // the logo. Use this when a prior slug-guess landed on a name-collision
  // (a different business sharing the same generic handle), or when the
  // cached fbcdn logo URL has expired. Clears website_url/website_kind/
  // logo_url/brand_color so stage-2's social-search branch fires again and
  // brand color is re-derived from the fresh logo.
  const refreshSocials = new URL(req.url).searchParams.get("refresh-socials") === "1";
  if (refreshSocials) {
    await getDb()
      .from("leads")
      .update({
        website_url: null,
        website_kind: "none",
        logo_url: null,
        brand_color: null,
      })
      .eq("id", params.id);
  }

  if (isCloudRunConfigured()) {
    const oidcToken =
      req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
    try {
      const op = await triggerJob(
        {
          MODE: "regenerate",
          LEAD_ID: params.id,
          FROM_STAGE: parsed.data.from_stage,
        },
        { oidcToken },
      );
      return ok(
        {
          id: params.id,
          from_stage: parsed.data.from_stage,
          runner: "cloud-run",
          operation: op.operationName,
        },
        { status: 202 },
      );
    } catch (err) {
      // Trigger failed — clear the in-progress flag immediately so the
      // operator isn't staring at a permanent spinner.
      await getDb().from("leads").update({ rebuild_started_at: null }).eq("id", params.id);
      log.error({ lead_id: params.id, err: String(err) }, "regenerate.trigger_failed");
      return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
    }
  }

  // Local-dev path
  rerunInProcess(params.id, parsed.data.from_stage)
    .catch((err) => log.error({ lead_id: params.id, err: String(err) }, "regenerate.failed"))
    .finally(async () => {
      await getDb().from("leads").update({ rebuild_started_at: null }).eq("id", params.id);
    });
  return ok(
    { id: params.id, from_stage: parsed.data.from_stage, runner: "local" },
    { status: 202 },
  );
});

async function rerunInProcess(leadId: string, fromStage: Step) {
  const db = getDb();
  let lead = (await db.from("leads").select("*").eq("id", leadId).single()).data;
  if (!lead) throw new Error("lead not found");

  const { data: batch } = await db
    .from("batches")
    .select("template_slug")
    .eq("id", lead.batch_id)
    .single();

  // Refetch the lead between stages — stage-2 writes brand_color / logo_url
  // / website_url / website_kind to DB but doesn't mutate the in-memory
  // object, so downstream stages would otherwise read a stale snapshot
  // (e.g. ship the monogram logo even though stage-2 already found the
  // real FB/IG profile picture).
  async function reload() {
    const { data } = await db.from("leads").select("*").eq("id", leadId).single();
    if (data) lead = data;
  }

  const start = ORDER.indexOf(fromStage);
  for (const step of ORDER.slice(start)) {
    if (step === "enrich") {
      await stage2.run(lead);
      await reload();
    }
    if (step === "generate") {
      await stage3.run(lead, batch?.template_slug ?? "trades");
      await reload();
    }
    if (step === "deploy") lead.demo_url = await stage4.run(lead);
    if (step === "outreach") await stage5.run(lead);
  }
}
