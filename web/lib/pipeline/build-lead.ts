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
import { isWebsiteBuildable, SUPPORTED_BUILD_NICHES_LABEL } from "../data/niches";
import { resolveDesign } from "../templates/registry";
import * as stage2 from "./stage-2-enrich";
import * as stage3 from "./stage-3-generate";
import * as stage4 from "./stage-4-deploy";
import * as stage4b from "./stage-4b-screenshot";

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
  rating: number | null;
  review_count: number | null;
  service_areas: string[];
  business_hours: Record<string, string> | null;
  template_variant: string | null;
}

export async function buildLead(leadId: string): Promise<{
  lead_id: string;
  demo_url: string | null;
  skipped?: boolean;
  reason?: string;
}> {
  const db = getDb();
  const { data: lead, error } = await db.from("leads").select("*").eq("id", leadId).single<DbLead>();
  if (error || !lead) throw new Error(`lead not found: ${leadId}`);

  const { data: batch } = await db
    .from("batches")
    .select("template_slug, template_variant")
    .eq("id", lead.batch_id)
    .single<{ template_slug: string; template_variant: string | null }>();
  const templateSlug = batch?.template_slug ?? "trades";
  const designSlug = resolveDesign(templateSlug, lead.template_variant, batch?.template_variant);

  // The website builder only runs for the five focus niches. Off-list niches
  // are still scraped + enriched (usable for email/SMS outreach) but get no
  // demo site. Skip cleanly — this is NOT a failure, so don't throw (that
  // would mark the lead failed and look like a broken build).
  if (!isWebsiteBuildable(templateSlug)) {
    const reason = `Website builder supports only ${SUPPORTED_BUILD_NICHES_LABEL}. This lead's niche (template '${templateSlug}') was skipped — it's still available for outreach.`;
    log.info(
      { lead_id: leadId, template_slug: templateSlug },
      "build_lead.skipped_non_focus_niche",
    );
    await db.from("leads").update({ last_error: reason }).eq("id", leadId);
    return { lead_id: leadId, demo_url: null, skipped: true, reason };
  }

  log.info({ lead_id: leadId, starting_stage: lead.stage }, "build_lead.start");

  /** Re-read the lead from DB. Stage-2 writes brand_color / logo_url /
   *  website_url / website_kind but does NOT mutate the in-memory `lead`,
   *  so stage-3 would see a stale snapshot without this refetch. */
  async function reloadLead(): Promise<DbLead> {
    const { data, error: e } = await db.from("leads").select("*").eq("id", leadId).single<DbLead>();
    if (e || !data) throw new Error(`lead disappeared mid-build: ${leadId}`);
    return data;
  }

  try {
    // Always run all three stages, regardless of the lead's persisted stage.
    // Each Cloud Run execution gets a fresh, ephemeral filesystem — if a
    // previous run completed stage 3 and persisted lead.stage='generated'
    // but failed at stage 4, the dist/ files no longer exist anywhere, so
    // skipping stages 2-3 on this run would leave stage 4 with nothing to
    // upload. All three stages are idempotent (they overwrite their own
    // DB rows + regenerate dist/), so re-running is safe.
    await stage2.run(lead as unknown as stage2.Lead);
    const enriched = await reloadLead();
    await stage3.run(enriched as unknown as stage3.Lead, templateSlug, {}, designSlug);
    const generated = await reloadLead();
    const demoUrl = await stage4.run(generated as unknown as stage4.Lead);

    // Capture a screenshot of the freshly-deployed demo for use in outreach
    // emails. Non-fatal: a failed/absent screenshot must not fail the build
    // (locally there's no Chromium, so this no-ops). dist/ still exists in this
    // execution but stage-4b hosts on Supabase Storage, not the Pages site.
    try {
      await stage4b.run({ id: leadId, business_name: lead.business_name, demo_url: demoUrl });
    } catch (e) {
      log.warn({ lead_id: leadId, err: String(e) }, "build_lead.screenshot_failed");
    }

    // Clear any error from a prior failed attempt — without this the
    // dashboard keeps showing a red "Last error" banner forever even after
    // a successful retry. (Stage 4 already wrote stage='deployed' and the
    // demo_url; we just need to null out the error.)
    await db.from("leads").update({ last_error: null }).eq("id", leadId);

    log.info({ lead_id: leadId, demo_url: demoUrl }, "build_lead.done");
    return { lead_id: leadId, demo_url: demoUrl };
  } catch (err) {
    await db.from("leads").update({ last_error: String(err).slice(0, 500) }).eq("id", leadId);
    log.error({ lead_id: leadId, err: String(err) }, "build_lead.failed");
    throw err;
  }
}
