/**
 * add-members.ts — add selected leads to a campaign as members.
 *
 * Filters the given lead_ids to those reachable on the campaign's channel, drops
 * suppressed leads + ones already in the campaign, inserts campaign_leads rows.
 * Returns a breakdown so the UI can report what was added vs skipped + why.
 * Used by: POST /api/campaigns (create-with-leads) + POST /api/campaigns/[id]/leads.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReachable, type ReachableLead } from "./reachability";
import type { Channel } from "./eligibility";
import { isSuppressed } from "../suppression";

const SUPPRESSION_CHANNEL: Record<Channel, "sms" | "email"> = {
  sms: "sms",
  dm: "sms", // no dedicated DM suppression channel; treat as sms-class for STOP
  email: "email",
};

export interface AddMembersResult {
  added: number;
  skipped: { not_reachable: number; suppressed: number; already_member: number };
}

interface LeadRow extends ReachableLead {
  lifecycle_stage: string | null;
}

export async function addMembers(
  db: SupabaseClient,
  campaign: { id: string; channel: Channel },
  leadIds: string[],
): Promise<AddMembersResult> {
  const result: AddMembersResult = {
    added: 0,
    skipped: { not_reachable: 0, suppressed: 0, already_member: 0 },
  };
  if (leadIds.length === 0) return result;

  // Load the candidate leads (only the columns reachability + suppression need).
  const { data: leadsData } = await db
    .from("leads")
    .select("id,email,phone,website_kind,lifecycle_stage")
    .in("id", leadIds)
    .limit(20000);
  const leads = (leadsData ?? []) as LeadRow[];

  // Already-members of this campaign (dedupe).
  const { data: existing } = await db
    .from("campaign_leads")
    .select("lead_id")
    .eq("campaign_id", campaign.id)
    .in("lead_id", leadIds)
    .limit(20000);
  const alreadyMember = new Set((existing ?? []).map((r: { lead_id: string }) => r.lead_id));

  const toInsert: string[] = [];
  for (const lead of leads) {
    if (alreadyMember.has(lead.id)) {
      result.skipped.already_member += 1;
      continue;
    }
    if (!isReachable(lead, campaign.channel)) {
      result.skipped.not_reachable += 1;
      continue;
    }
    if (await isSuppressed(lead, SUPPRESSION_CHANNEL[campaign.channel])) {
      result.skipped.suppressed += 1;
      continue;
    }
    toInsert.push(lead.id);
  }

  if (toInsert.length > 0) {
    const rows = toInsert.map((lead_id) => ({ campaign_id: campaign.id, lead_id }));
    const { error } = await db.from("campaign_leads").insert(rows);
    if (error) throw new Error(`membership insert failed: ${error.message}`);
    result.added = toInsert.length;
  }
  return result;
}
