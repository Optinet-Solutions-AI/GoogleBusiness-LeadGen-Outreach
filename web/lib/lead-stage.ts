/**
 * lead-stage.ts — record a lead stage transition into lead_stage_events.
 *
 * Inputs:  lead id + the stage it moved to (+ optional from)
 * Outputs: one lead_stage_events row (best-effort)
 * Used by: app/api/leads/[id]/meeting + app/api/leads/[id] (PATCH stage)
 *
 * Gives reporting KPIs (meetings booked, deals closed) an exact timestamp for
 * WHEN a lead entered a stage, instead of leaning on leads.updated_at (which any
 * edit bumps). Best-effort: a logging failure never breaks the caller's update.
 */

import "server-only";
import { getDb } from "./db";
import { getLogger } from "./logger";

const log = getLogger("lead-stage");

export async function recordStageEvent(
  leadId: string,
  toStage: string,
  fromStage: string | null = null,
): Promise<void> {
  try {
    const { error } = await getDb()
      .from("lead_stage_events")
      .insert({ lead_id: leadId, to_stage: toStage, from_stage: fromStage });
    if (error) log.warn({ leadId, toStage, err: error.message }, "lead-stage.record_failed");
  } catch (e) {
    log.warn({ leadId, toStage, err: String(e) }, "lead-stage.record_threw");
  }
}
