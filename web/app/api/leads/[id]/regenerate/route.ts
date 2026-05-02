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

  // Mark the rebuild as in progress so a page refresh can restore the
  // spinner state. Cleared by the client polling loop on success/failure;
  // the dashboard auto-falls-out-of-spinner if the timestamp goes stale
  // (>5 min old), so a crashed job can't leave the UI stuck forever.
  await getDb()
    .from("leads")
    .update({ rebuild_started_at: new Date().toISOString(), last_error: null })
    .eq("id", params.id);

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
  const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single();
  if (!lead) throw new Error("lead not found");

  const { data: batch } = await db
    .from("batches")
    .select("template_slug")
    .eq("id", lead.batch_id)
    .single();

  const start = ORDER.indexOf(fromStage);
  for (const step of ORDER.slice(start)) {
    if (step === "enrich") await stage2.run(lead);
    if (step === "generate") await stage3.run(lead, batch?.template_slug ?? "trades");
    if (step === "deploy") lead.demo_url = await stage4.run(lead);
    if (step === "outreach") await stage5.run(lead);
  }
}
