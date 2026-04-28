/**
 * api/leads/[id]/regenerate/route.ts — Re-run a lead from a given stage.
 *
 * POST /api/leads/:id/regenerate  body: { from_stage: 'enrich'|'generate'|'deploy'|'outreach' }
 *
 * Long-running. Fire-and-forget; errors get logged + persisted on the lead row.
 * For production reliability switch to a queue (Inngest, Cloudflare Queues).
 */

import { z } from "zod";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import * as stage2 from "@/lib/pipeline/stage-2-enrich";
import * as stage3 from "@/lib/pipeline/stage-3-generate";
import * as stage4 from "@/lib/pipeline/stage-4-deploy";
import * as stage5 from "@/lib/pipeline/stage-5-outreach";
import { fail, ok } from "@/lib/response";

const log = getLogger("api.leads.regenerate");

const Body = z.object({
  from_stage: z.enum(["enrich", "generate", "deploy", "outreach"]),
});

const ORDER = ["enrich", "generate", "deploy", "outreach"] as const;
type Step = (typeof ORDER)[number];

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  rerun(params.id, parsed.data.from_stage).catch((err) =>
    log.error({ lead_id: params.id, err: String(err) }, "regenerate.failed"),
  );
  return ok({ id: params.id, from_stage: parsed.data.from_stage }, { status: 202 });
}

async function rerun(leadId: string, fromStage: Step) {
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
