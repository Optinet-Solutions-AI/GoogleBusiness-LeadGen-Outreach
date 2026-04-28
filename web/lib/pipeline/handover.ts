/**
 * handover.ts — Hand the deployed site to the customer.
 *
 * Two modes:
 *   - 'attach'   (recommended) — keep the Cloudflare Pages project under our
 *                account, attach the customer's domain. We retain hosting,
 *                they get a real URL. Recurring revenue intact.
 *   - 'transfer' — manual step (Cloudflare doesn't expose a project-transfer
 *                API). We document the steps and mark the lead as transferred.
 *
 * Inputs:  leadId, mode, optional custom_domain (required for 'attach')
 * Outputs: lead.custom_domain set, lead.handover_mode set, lead.stage='handed_over'
 * Used by: app/api/leads/[id]/handover/route.ts
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import * as cloudflare from "../services/cloudflare-pages";
import { slugify } from "../slugify";

const log = getLogger("handover");

export type HandoverMode = "attach" | "transfer";

export interface HandoverInput {
  mode: HandoverMode;
  custom_domain?: string;
}

export interface HandoverResult {
  lead_id: string;
  mode: HandoverMode;
  custom_domain?: string;
  dns_instructions?: { type: "CNAME" | "A"; name: string; value: string }[];
}

export async function run(leadId: string, input: HandoverInput): Promise<HandoverResult> {
  const db = getDb();
  const { data: lead, error } = await db.from("leads").select("*").eq("id", leadId).single();
  if (error || !lead) throw new Error(`lead not found: ${leadId}`);
  if (!lead.demo_url) throw new Error("lead has no demo_url — must be deployed first");

  const slug = slugify(lead.business_name);

  if (input.mode === "attach") {
    if (!input.custom_domain) throw new Error("custom_domain required for attach mode");

    log.info({ lead_id: leadId, domain: input.custom_domain }, "handover.attach.start");
    await cloudflare.attachCustomDomain(slug, input.custom_domain);

    await db
      .from("leads")
      .update({
        custom_domain: input.custom_domain,
        handover_mode: "attach",
        stage: "handed_over",
      })
      .eq("id", leadId);

    return {
      lead_id: leadId,
      mode: "attach",
      custom_domain: input.custom_domain,
      dns_instructions: [
        { type: "CNAME", name: input.custom_domain, value: `${slug}.pages.dev` },
      ],
    };
  }

  // transfer mode — record the intent; actual project transfer is done by hand
  // in the Cloudflare dashboard (no API for this as of writing).
  log.info({ lead_id: leadId }, "handover.transfer.recorded");
  await db
    .from("leads")
    .update({
      handover_mode: "transfer",
      stage: "handed_over",
    })
    .eq("id", leadId);

  return { lead_id: leadId, mode: "transfer" };
}
