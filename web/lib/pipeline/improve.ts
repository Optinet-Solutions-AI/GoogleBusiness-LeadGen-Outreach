/**
 * improve.ts — Regenerate a lead's site with operator-supplied data.
 *
 * Inputs:  lead, optional photo URLs / copy overrides / service-area list
 * Outputs: rebuilt + redeployed site, lead.stage='improved'
 * Used by: app/api/leads/[id]/improve/route.ts (after the sales meeting)
 *
 * Difference vs the regular regenerate flow: the operator hands in *real*
 * customer data (their photos, edited copy, confirmed services + areas)
 * instead of Maps-derived defaults. Same stage-3 + stage-4 underneath.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import * as stage3 from "./stage-3-generate";
import * as stage4 from "./stage-4-deploy";
import type { OverrideCopy } from "./stage-3-generate";

const log = getLogger("improve");

export interface ImproveInput {
  photos?: string[];                                 // replace lead.photos
  copy?: OverrideCopy;                                // hand-edited copy
  service_areas?: string[];                           // confirmed cities
  business_hours?: Record<string, string>;            // mon..sun strings
  brand_color?: string;                               // override extracted color
  notes?: string;                                     // operator notes
}

export async function run(leadId: string, input: ImproveInput): Promise<string> {
  const db = getDb();
  const { data: lead, error } = await db.from("leads").select("*").eq("id", leadId).single();
  if (error || !lead) throw new Error(`lead not found: ${leadId}`);

  const { data: batch } = await db
    .from("batches")
    .select("template_slug")
    .eq("id", lead.batch_id)
    .single();
  const templateSlug = batch?.template_slug ?? "trades";

  // Persist operator-supplied facts onto the lead row first so the rebuild reads them.
  const patch: Record<string, unknown> = {};
  if (input.photos) patch.photos = input.photos;
  if (input.service_areas) patch.service_areas = input.service_areas;
  if (input.business_hours) patch.business_hours = input.business_hours;
  if (input.brand_color) patch.brand_color = input.brand_color;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (Object.keys(patch).length) {
    await db.from("leads").update(patch).eq("id", leadId);
    Object.assign(lead, patch);
  }

  log.info({ lead_id: leadId, has_overrides: !!input.copy }, "improve.start");

  await stage3.run(lead, templateSlug, {
    copy: input.copy,
    photos: input.photos,
  });
  const liveUrl = await stage4.run(lead);

  await db.from("leads").update({ stage: "improved" }).eq("id", leadId);
  log.info({ lead_id: leadId, url: liveUrl }, "improve.done");
  return liveUrl;
}
