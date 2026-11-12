/**
 * calls/quick-call.ts — "Call with AI" for one lead: put it in the standing Quick calls campaign.
 *
 * Inputs:  lead id + the greeting name the operator confirmed in the call preview (null = no name)
 * Outputs: { queued, campaign_id, message } — or { queued: false, message } with the plain reason.
 *          Saves the greeting on the member (campaign_leads.call_name); the dialler sends it to Voizo.
 * Used by: app/api/leads/[id]/call/route.ts (lead page + leads-list buttons)
 *
 * The AI caller only dials members of an ACTIVE call campaign (lib/pipeline/call-scheduler.ts, every 15 min).
 * Instead of making the operator build a campaign for one lead, we keep one standing campaign per country,
 * "Quick calls (AI) · <country>", active, every day 9–20 in that country's time, and add the lead to it.
 * The same gates as the scheduler apply up front so the operator hears "why not" immediately.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { addMembers } from "@/lib/campaigns/add-members";
import { campaignTimezone } from "@/lib/call-hours";
import { isVoizoConfigured } from "@/lib/services/voizo";
import { callBlock } from "@/lib/leads/contact-readiness";
import { cleanGreetingName } from "@/lib/calls/greeting-name";
import { isMissingColumn } from "@/lib/db-errors";

const log = getLogger("quick-call");

export const QUICK_CALL_PREFIX = "Quick calls (AI)";

export function quickCampaignName(countryCode: string | null): string {
  return `${QUICK_CALL_PREFIX} · ${(countryCode ?? "xx").toUpperCase()}`;
}

export interface QuickCallResult {
  queued: boolean;
  campaign_id: string | null;
  message: string;
}

export async function queueQuickCall(leadId: string, opts: { greetingName?: string | null } = {}): Promise<QuickCallResult> {
  if (!isVoizoConfigured()) {
    return { queued: false, campaign_id: null, message: "AI calling isn't connected (no Voizo key). Ask the admin." };
  }
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .select("id,business_name,phone,country_code,lifecycle_stage,call_status,email,verification_status")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Lead not found");
  const lead = data as {
    id: string; business_name: string; phone: string | null; country_code: string | null;
    lifecycle_stage: string | null; call_status: string | null; email: string | null; verification_status: string | null;
  };
  const block = callBlock(lead);
  if (block) return { queued: false, campaign_id: null, message: block };

  const country = (lead.country_code ?? "us").toLowerCase();
  const name = quickCampaignName(country);
  let campaignId: string | null = null;
  const { data: existing } = await db
    .from("call_campaigns")
    .select("id,status")
    .eq("channel", "call")
    .eq("name", name)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    campaignId = (existing as { id: string }).id;
    if ((existing as { status: string }).status !== "active") {
      await db.from("call_campaigns").update({ status: "active" }).eq("id", campaignId);
    }
  } else {
    const { data: camp, error: cErr } = await db
      .from("call_campaigns")
      .insert({
        name,
        source: "manual",
        channel: "call",
        country_code: country,
        call_days: [1, 2, 3, 4, 5, 6, 7],
        call_start_hour: 9,
        call_end_hour: 20,
        timezone: campaignTimezone(country),
        status: "active",
      })
      .select("id")
      .single();
    if (cErr || !camp) throw new Error(`campaign insert failed: ${cErr?.message}`);
    campaignId = (camp as { id: string }).id;
  }

  const added = await addMembers(db, { id: campaignId, channel: "call" }, [leadId]);
  log.info({ lead_id: leadId, campaign_id: campaignId, added }, "quick_call.queued");
  const queued = added.added === 1 || Boolean(added.skipped.already_member);
  const nameNote = queued ? await saveGreetingName(campaignId, leadId, cleanGreetingName(opts.greetingName)) : "";
  if (added.added === 1) {
    return {
      queued: true,
      campaign_id: campaignId,
      message: `${lead.business_name} is queued. The AI calls within about 15 minutes, between 9:00 and 20:00 ${campaignTimezone(country)} time. The result shows here and in the CRM.${nameNote}`,
    };
  }
  if (added.skipped.already_member) {
    return { queued: true, campaign_id: campaignId, message: `${lead.business_name} is already in the call queue — the AI calls it in the next window.${nameNote}` };
  }
  if (added.skipped.suppressed) return { queued: false, campaign_id: campaignId, message: "This lead is on the do-not-contact list." };
  return { queued: false, campaign_id: campaignId, message: "This lead can't be reached by phone." };
}

/** Store the confirmed greeting on the queue entry. Returns a note for the operator when it couldn't be saved. */
async function saveGreetingName(campaignId: string, leadId: string, name: string | null): Promise<string> {
  const { error } = await getDb()
    .from("campaign_leads")
    .update({ call_name: name })
    .eq("campaign_id", campaignId)
    .eq("lead_id", leadId);
  if (!error) return "";
  if (isMissingColumn(error, "call_name")) {
    return name ? " The greeting name isn't saved yet (database update 059 pending), so the agent won't use a name." : "";
  }
  log.warn({ lead_id: leadId, err: error.message }, "quick_call.name_save_failed");
  return name ? " The greeting name couldn't be saved, so the agent won't use a name." : "";
}
