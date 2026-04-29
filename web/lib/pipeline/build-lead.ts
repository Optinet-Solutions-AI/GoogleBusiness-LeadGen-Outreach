/**
 * build-lead.ts — Build + deploy ONE lead's website on demand.
 *
 * Inputs:  leadId
 * Outputs: live demo URL + lead.stage='deployed'
 * Used by: app/api/leads/[id]/build/route.ts (Build button on the dashboard)
 *
 * Runs stages 2 → 3 → 4 in sequence on a single lead. Each stage is
 * idempotent, so re-running on a lead that already passed a stage is safe
 * — the function checks current stage and only runs the next one.
 *
 * This function exists separately from orchestrator.runBatch because the
 * dashboard model is "operator picks which businesses to build" — we never
 * auto-build everything in a batch.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import * as stage2 from "./stage-2-enrich";
import * as stage3 from "./stage-3-generate";
import * as stage4 from "./stage-4-deploy";

const log = getLogger("build-lead");

interface DbLead {
  id: string;
  business_name: string;
  batch_id: string;
  stage: string;
  brand_color: string | null;
  email: string | null;
  photos: unknown[];
  reviews: unknown[];
  phone: string | null;
  address: string | null;
  category: string | null;
  service_areas: string[];
  business_hours: Record<string, string> | null;
}

export async function buildLead(leadId: string): Promise<{
  lead_id: string;
  demo_url: string;
}> {
  const db = getDb();
  const { data: lead, error } = await db.from("leads").select("*").eq("id", leadId).single<DbLead>();
  if (error || !lead) throw new Error(`lead not found: ${leadId}`);

  const { data: batch } = await db
    .from("batches")
    .select("template_slug")
    .eq("id", lead.batch_id)
    .single<{ template_slug: string }>();
  const templateSlug = batch?.template_slug ?? "trades";

  log.info({ lead_id: leadId, starting_stage: lead.stage }, "build_lead.start");

  try {
    // Stage 2: enrich (brand color, etc.)
    if (lead.stage === "scraped") {
      await stage2.run(lead as unknown as stage2.Lead);
      lead.stage = "enriched";
    }

    // Stage 3: generate (Gemini copy + Astro build)
    if (lead.stage === "enriched") {
      await stage3.run(lead as unknown as stage3.Lead, templateSlug);
      lead.stage = "generated";
    }

    // Stage 4: deploy (Cloudflare Pages)
    let demoUrl = "";
    if (lead.stage === "generated") {
      demoUrl = await stage4.run(lead as unknown as stage4.Lead);
      lead.stage = "deployed";
    } else {
      // Already deployed previously — fetch the existing URL
      const { data } = await db.from("leads").select("demo_url").eq("id", leadId).single();
      demoUrl = (data?.demo_url as string) ?? "";
    }

    log.info({ lead_id: leadId, demo_url: demoUrl }, "build_lead.done");
    return { lead_id: leadId, demo_url: demoUrl };
  } catch (err) {
    await db.from("leads").update({ last_error: String(err).slice(0, 500) }).eq("id", leadId);
    log.error({ lead_id: leadId, err: String(err) }, "build_lead.failed");
    throw err;
  }
}
