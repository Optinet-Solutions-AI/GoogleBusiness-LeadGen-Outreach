/**
 * stage-5-outreach.ts — Queue a personalized cold email via Instantly.
 *
 * Inputs:  lead row at stage='deployed' with demo_url + email
 * Outputs: outreach_events row, lead.stage='outreached'
 * Used by: lib/pipeline/orchestrator.ts
 *
 * If `lead.email` is null we mark the lead 'needs_email' and skip — operator
 * can plug in an email finder (Hunter / Apollo) later.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import * as instantly from "../services/instantly";

const log = getLogger("stage-5");

const DEFAULT_CAMPAIGN_ID = "REPLACE_WITH_INSTANTLY_CAMPAIGN_ID";

export interface Lead {
  id: string;
  business_name: string;
  email: string | null;
  demo_url: string | null;
}

export async function run(lead: Lead, campaignId: string = DEFAULT_CAMPAIGN_ID): Promise<string | null> {
  const db = getDb();

  if (!lead.email) {
    await db.from("leads").update({ stage: "needs_email" }).eq("id", lead.id);
    log.info({ lead_id: lead.id }, "stage_5.skip_no_email");
    return null;
  }
  if (!lead.demo_url) {
    throw new Error(`lead ${lead.id} has no demo_url — run stage_4 first`);
  }

  const firstName = (lead.business_name.split(/\s+/)[0] || "there").trim();

  const providerId = await instantly.addLeadToCampaign({
    campaign_id: campaignId,
    email: lead.email,
    first_name: firstName,
    business_name: lead.business_name,
    demo_url: lead.demo_url,
  });

  await db.from("outreach_events").insert({
    lead_id: lead.id,
    kind: "email_sent",
    meta: { provider: "instantly", provider_lead_id: providerId },
  });
  await db.from("leads").update({ stage: "outreached" }).eq("id", lead.id);

  log.info({ lead_id: lead.id, providerId }, "stage_5.done");
  return providerId;
}
