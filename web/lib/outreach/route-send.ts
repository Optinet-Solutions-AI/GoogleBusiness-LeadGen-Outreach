/**
 * route-send.ts — Pick + fire the right outreach channel for a lead ("best channel").
 *
 * Inputs:  a lead row (email, phone, stage, + the fields the email/SMS stages need)
 * Outputs: chooseChannel() = which channel + why; sendViaBestChannel() = runs it
 * Used by: app/api/leads/send/route.ts (bulk "Send via best channel")
 *
 * Rule (use whatever contact exists): already-outreached → skip; else email if present → email;
 * else phone if present → SMS; else skip (no contact). Suppression is enforced inside the stages.
 */

import { run as runEmail } from "../pipeline/stage-5-email";
import { run as runSms } from "../pipeline/stage-6-sms";

/** Lead shape the bulk sender needs — assignable to both EmailLead and SmsLead. */
export interface RoutableLead {
  id: string;
  business_name: string;
  email: string | null;
  phone: string | null;
  demo_url?: string | null;
  primary_offer?: string | null;
  lifecycle_stage?: string | null;
  stage?: string | null;
}

export type Channel = "email" | "sms" | "skip";

/** Stages that mean the lead was already contacted (skip unless resend). */
const OUTREACHED_STAGES = new Set([
  "outreached",
  "replied",
  "meeting_booked",
  "meeting_done",
  "improved",
  "handed_over",
  "closed_won",
  "closed_lost",
]);

export type ChooseReason = "ok" | "already" | "no_contact";

export function chooseChannel(
  lead: RoutableLead,
  opts: { resend?: boolean } = {},
): { channel: Channel; reason: ChooseReason } {
  if (!opts.resend && lead.stage && OUTREACHED_STAGES.has(lead.stage)) {
    return { channel: "skip", reason: "already" };
  }
  if (lead.email && lead.email.includes("@")) return { channel: "email", reason: "ok" };
  if (lead.phone && lead.phone.trim()) return { channel: "sms", reason: "ok" };
  return { channel: "skip", reason: "no_contact" };
}

export interface SendOutcome {
  channel: Channel;
  reason: ChooseReason;
  sent: boolean;
  skipped?: string;
  noop?: boolean;
}

/** Route the lead and actually send via the chosen channel. Never throws — returns the outcome. */
export async function sendViaBestChannel(
  lead: RoutableLead,
  opts: { resend?: boolean } = {},
): Promise<SendOutcome> {
  const { channel, reason } = chooseChannel(lead, opts);
  if (channel === "skip") return { channel, reason, sent: false, skipped: reason };

  try {
    if (channel === "email") {
      const r = await runEmail(lead);
      return { channel, reason, sent: r.sent, skipped: r.skipped, noop: r.noop };
    }
    const r = await runSms(lead);
    return { channel, reason, sent: r.sent, skipped: r.skipped, noop: r.noop };
  } catch {
    return { channel, reason, sent: false, skipped: "error" };
  }
}
