/**
 * campaigns/campaign-status.ts — pause, resume or finish a campaign, and carry that to its leads' emails.
 *
 * Inputs:  campaign id, the new status (active | paused | done); call_campaigns, campaign_leads, leads.seq_status
 * Outputs: the campaign row { id, status } (null = not found); its members' sequences paused / resumed / stopped
 * Used by: app/api/campaigns/[id]/route.ts (the Campaigns page toggle), lib/brain/{approve,control}.ts
 *
 * The sequence tick fires on leads.seq_status, not on the campaign's status, so the change must reach the members:
 * pause active → paused; resume paused → active (seq_next_step_at is kept, so it picks up where it left); done = no
 * more emails from this campaign. Moved here unchanged from the route (26 Nov 2026) so the Brain uses the same code.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";

export type CampaignStatus = "active" | "paused" | "done";

export async function setCampaignStatus(id: string, status: CampaignStatus): Promise<{ id: string; status: string } | null> {
  const db = getDb();
  const { data, error } = await db.from("call_campaigns").update({ status }).eq("id", id).select("id,status").single();
  if (error || !data) return null;

  const { data: members } = await db.from("campaign_leads").select("lead_id").eq("campaign_id", id);
  const leadIds = (members ?? []).map((m: { lead_id: string }) => m.lead_id);
  for (let i = 0; i < leadIds.length; i += 200) {
    const ids = leadIds.slice(i, i + 200);
    if (status === "paused") {
      await db.from("leads").update({ seq_status: "paused" }).in("id", ids).eq("seq_status", "active");
    } else if (status === "active") {
      await db.from("leads").update({ seq_status: "active" }).in("id", ids).eq("seq_status", "paused");
    } else {
      // Done = no more emails from this campaign (review, 24 Nov 2026: it used to keep sending).
      await db.from("leads").update({ seq_status: "stopped", seq_next_step_at: null }).in("id", ids).in("seq_status", ["active", "paused"]);
    }
  }
  return data as { id: string; status: string };
}
