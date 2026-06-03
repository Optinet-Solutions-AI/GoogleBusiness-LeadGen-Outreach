/**
 * stage-6-sms.ts — Text an interested lead a one-time link to the intake form.
 *
 * Inputs:  a lead ({ id, business_name, phone, lifecycle_stage }) + optional call_attempt id
 * Outputs: a form_links row, an sms_messages row, leads.sms_status, an outreach_events row
 * Used by: app/api/leads/[id]/call/outcome/route.ts (fires when a call is marked 'interested')
 *
 * Idempotent: skips if a live link already exists for the lead (no double-texting). Gated by the
 * suppression list (DNC/STOP). Runs at $0 — with no Mobivate key the send soft-no-ops but the link,
 * form and inbox are all real. Never throws into its caller; returns a result.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import { env } from "../config";
import { isSuppressed } from "../suppression";
import { issueFormLink } from "../form-links";
import { sendSms } from "../services/mobivate";

const log = getLogger("stage-6-sms");

export interface SmsLead {
  id: string;
  business_name: string;
  phone: string | null;
  lifecycle_stage?: string | null;
}

export interface SmsResult {
  sent: boolean;
  skipped?: "no_phone" | "suppressed" | "already_sent" | "issue_failed";
  formLinkId?: string;
  noop?: boolean;
  /** The one-time form URL. Returned so a $0/no-op test can open the form without a real text. */
  link?: string;
}

export async function run(lead: SmsLead, callAttemptId?: string | null): Promise<SmsResult> {
  const db = getDb();

  if (!lead.phone) {
    log.warn({ lead_id: lead.id }, "stage_6_sms.skip_no_phone");
    return { sent: false, skipped: "no_phone" };
  }

  if (await isSuppressed(lead, "sms")) {
    log.info({ lead_id: lead.id }, "stage_6_sms.suppressed");
    return { sent: false, skipped: "suppressed" };
  }

  // Don't double-text: if a live link already exists for this lead, we've already reached out.
  const { data: live } = await db
    .from("form_links")
    .select("id")
    .eq("lead_id", lead.id)
    .in("status", ["issued", "opened"])
    .limit(1)
    .maybeSingle();
  if (live) {
    log.info({ lead_id: lead.id, form_link: live.id }, "stage_6_sms.already_sent");
    return { sent: false, skipped: "already_sent", formLinkId: live.id };
  }

  const issued = await issueFormLink(lead.id, callAttemptId ?? null, "stage-6-sms");
  if (!issued) return { sent: false, skipped: "issue_failed" };

  const link = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/form/${issued.token}`;
  const body = `Hi ${lead.business_name}! Sam from Optirate here — as promised, here's a quick spot to drop your details so I can put your free website sample together: ${link}`;

  // Insert the SMS record FIRST (dedupe_key = form link id → unique per link), then send.
  await db.from("sms_messages").insert({
    lead_id: lead.id,
    direction: "outbound",
    to_number: lead.phone,
    from_number: env.MOBIVATE_SENDER_ID || "Optirate",
    body,
    status: "queued",
    dedupe_key: issued.formLinkId,
  });

  const result = await sendSms({ to: lead.phone, body, reference: issued.formLinkId });

  await db
    .from("sms_messages")
    .update({ status: result.status, provider_msg_id: result.providerMsgId, meta: { noop: result.noop } })
    .eq("lead_id", lead.id)
    .eq("dedupe_key", issued.formLinkId);

  const smsStatus = result.status === "sent" ? "sent" : "failed";
  await db.from("leads").update({ sms_status: smsStatus }).eq("id", lead.id);

  await db.from("outreach_events").insert({
    lead_id: lead.id,
    kind: "sms_sent",
    meta: { form_link_id: issued.formLinkId, noop: result.noop, status: result.status },
  });

  log.info({ lead_id: lead.id, form_link: issued.formLinkId, noop: result.noop }, "stage_6_sms.done");
  return { sent: result.status === "sent", formLinkId: issued.formLinkId, noop: result.noop, link };
}
