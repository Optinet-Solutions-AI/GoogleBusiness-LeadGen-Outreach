/**
 * email/send-simple.ts — send ONE email to a lead, written (or picked from a service template) by the operator,
 * with optional follow-ups.
 *
 * Inputs:  lead id, { subject, body (plain text), senderEmail?, followUps? (plain text, max 2) }; the lead row,
 *          its suppression + verification state, the active mailboxes
 * Outputs: the email goes out now through Ongage from a connected mailbox; an email_messages row (Inbox thread),
 *          an outreach_events 'email_sent' {manual:true} row (CRM timeline), stage → outreached when earlier.
 *          With follow-ups: the lead's sequence state is set so the sequence tick sends each one 4 days apart as
 *          "Re: <subject>" from the same mailbox, stopping on a reply / bounce / unsubscribe (leads.seq_max_step,
 *          migration 060). Returns { sent:true, via, checked, followUps, note? } or { sent:false, reason, message }.
 * Used by: app/api/leads/[id]/send-email/route.ts (the "Send email" window on the lead page + Leads list)
 *
 * Same safety rules as every other send: the kill switch, unsubscribed / do-not-contact, and verification
 * (a never-checked address is checked first, under 1 cent; only valid / catch-all addresses are emailed).
 * Operator 1:1 email, like an Inbox reply: it counts toward the mailbox's daily total but isn't held by it.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { isSuppressed } from "@/lib/suppression";
import { sendDecision } from "@/lib/verify/gate";
import { verifyLead } from "@/lib/verify/verify-lead";
import { verificationActive } from "@/lib/services/email-validator";
import { getSenderAccount, sendFromAccount } from "@/lib/services/email-sender";
import { isOngageConfigured } from "@/lib/services/ongage";
import { needsCheck } from "@/lib/email/enroll-lead";
import { textToHtml } from "@/lib/email/plain-text";
import { FOLLOW_UP_GAP_DAYS, replySubject } from "@/lib/email/service-templates";
import { isMissingColumn } from "@/lib/db-errors";
import type { VerifyStatus } from "@/lib/services/email-validator/types";

const log = getLogger("send-simple");

export type SimpleSendRefusal =
  | "paused"
  | "not_configured"
  | "no_email"
  | "suppressed"
  | "bad_address"
  | "unconfirmed"
  | "checker_down"
  | "no_mailbox"
  | "send_failed";

export const SIMPLE_SEND_TEXT: Record<SimpleSendRefusal, string> = {
  paused: "All email sending is paused right now (kill switch). Nothing was sent.",
  not_configured: "Sending isn't switched on for this server (the Ongage settings are missing). Nothing was sent.",
  no_email: "This lead has no email address. Add one first.",
  suppressed: "This lead unsubscribed or is on the do-not-contact list, so it can't be emailed.",
  bad_address: "This address failed the email check. Fix or replace it, then try again.",
  unconfirmed:
    "The email checker couldn't confirm this address, so nothing was sent (unconfirmed addresses hurt the mailbox's reputation). Fix the address or find another one.",
  checker_down:
    "The email checker is out of credits (ZeroBounce), so this address couldn't be checked and nothing was sent. Top up ZeroBounce, then try again.",
  no_mailbox: "No sending mailbox is connected. Connect one on the Email page first.",
  send_failed: "The email didn't go out.",
};

const EARLY_STAGES = new Set(["scraped", "enriched", "generated", "deployed", "needs_email"]);
export const MAX_FOLLOW_UPS = 2;

export interface SimpleLead {
  id: string;
  email: string | null;
  stage: string | null;
  inbox_status: string | null;
  verification_status: string | null;
  phone: string | null;
  lifecycle_stage: string | null;
  address: string | null;
  country_code: string | null;
}

type Account = NonNullable<Awaited<ReturnType<typeof getSenderAccount>>>;

export interface FollowUpPlan {
  via: string;
  subject: string;
  followUps: string[];
}

export interface SimpleSendDeps {
  paused: () => boolean;
  configured: () => boolean;
  load: (id: string) => Promise<SimpleLead | null>;
  suppressed: (lead: SimpleLead) => Promise<boolean>;
  verificationOn: () => boolean;
  verify: (lead: { id: string; email: string }) => Promise<{ status: string; audit?: { zerobounce_result?: string | null } } | null>;
  account: (senderEmail?: string | null) => Promise<Account | null>;
  send: (account: Account, to: string, subject: string, html: string) => Promise<{ success: true; messageId: string } | { success: false; error: string }>;
  record: (lead: SimpleLead, sent: { via: string; messageId: string; subject: string; body: string }) => Promise<void>;
  scheduleFollowUps: (lead: SimpleLead, plan: FollowUpPlan) => Promise<{ scheduled: boolean; note?: string }>;
}

export type SimpleSendResult =
  | { sent: true; via: string; checked: boolean; followUps: number; note?: string }
  | { sent: false; reason: SimpleSendRefusal; message: string; checked: boolean };

function refuse(reason: SimpleSendRefusal, checked = false, detail?: string): SimpleSendResult {
  return { sent: false, reason, message: detail ? `${SIMPLE_SEND_TEXT[reason]} ${detail}` : SIMPLE_SEND_TEXT[reason], checked };
}

export async function sendSimpleEmail(
  leadId: string,
  input: { subject: string; body: string; senderEmail?: string | null; followUps?: string[] },
  deps: SimpleSendDeps = defaultDeps,
): Promise<SimpleSendResult> {
  if (deps.paused()) return refuse("paused");
  if (!deps.configured()) return refuse("not_configured");
  const lead = await deps.load(leadId);
  if (!lead) throw new Error(`lead not found: ${leadId}`);
  if (!lead.email) return refuse("no_email");
  if (await deps.suppressed(lead)) return refuse("suppressed");

  let status = lead.verification_status;
  let checked = false;
  let checkerOut = false;
  if (deps.verificationOn() && needsCheck(status)) {
    const r = await deps.verify({ id: lead.id, email: lead.email });
    if (r) {
      status = r.status;
      checked = true;
      checkerOut = r.audit?.zerobounce_result === "no_credits";
    }
  }
  const decision = sendDecision(status as VerifyStatus | null, deps.verificationOn());
  if (decision === "skip") return refuse("bad_address", checked);
  if (decision === "hold") return refuse(checkerOut ? "checker_down" : "unconfirmed", checked);

  const account = await deps.account(input.senderEmail);
  if (!account) return refuse("no_mailbox", checked);

  const subject = input.subject.trim();
  const res = await deps.send(account, lead.email, subject, textToHtml(input.body));
  if (!res.success) {
    log.warn({ lead_id: leadId, err: res.error }, "send_simple.failed");
    return refuse("send_failed", checked, res.error);
  }
  await deps.record(lead, { via: account.email, messageId: res.messageId, subject, body: input.body.trim() });
  log.info({ lead_id: leadId, via: account.email }, "send_simple.sent");

  const followUps = (input.followUps ?? []).map((f) => f.trim()).filter(Boolean).slice(0, MAX_FOLLOW_UPS);
  if (!followUps.length) return { sent: true, via: account.email, checked, followUps: 0 };
  const plan = await deps.scheduleFollowUps(lead, { via: account.email, subject, followUps });
  return plan.scheduled
    ? { sent: true, via: account.email, checked, followUps: followUps.length }
    : { sent: true, via: account.email, checked, followUps: 0, note: plan.note };
}

/** The leads-row patch that hands the follow-ups to the sequence tick (first email = step 1, already sent). */
export function followUpPatch(plan: FollowUpPlan, now = Date.now()): Record<string, unknown> {
  const copy: Record<string, { subject: string; body: string }> = {};
  plan.followUps.forEach((body, i) => {
    copy[String(i + 2)] = { subject: replySubject(plan.subject), body };
  });
  return {
    seq_status: "active",
    seq_step: 1,
    seq_next_step_at: new Date(now + FOLLOW_UP_GAP_DAYS * 86_400_000).toISOString(),
    seq_sender_email: plan.via,
    seq_copy_overrides: copy,
    seq_max_step: plan.followUps.length + 1,
  };
}

const defaultDeps: SimpleSendDeps = {
  paused: () => {
    const until = process.env.EMAIL_SENDING_PAUSED_UNTIL;
    return Boolean(until && Date.parse(until) > Date.now());
  },
  configured: isOngageConfigured,
  load: async (id) => {
    const { data } = await getDb()
      .from("leads")
      .select("id,email,stage,inbox_status,verification_status,phone,lifecycle_stage,address,country_code")
      .eq("id", id)
      .maybeSingle();
    return (data as SimpleLead | null) ?? null;
  },
  suppressed: (lead) => isSuppressed(lead, "email"),
  verificationOn: verificationActive,
  verify: verifyLead,
  account: (senderEmail) => getSenderAccount(senderEmail).catch(() => null),
  send: (account, to, subject, html) => sendFromAccount(account, to, subject, html, {}),
  record: async (lead, s) => {
    const db = getDb();
    await db.from("email_messages").insert({
      lead_id: lead.id,
      direction: "outbound",
      message_id: s.messageId,
      from_addr: s.via,
      to_addr: lead.email,
      subject: s.subject,
      body_text: s.body,
      body_snippet: s.body.slice(0, 200),
      status: "sent",
    });
    await db.from("outreach_events").insert({
      lead_id: lead.id,
      kind: "email_sent",
      meta: { manual: true, message_id: s.messageId, to: lead.email, via: s.via, subject: s.subject },
    });
    const patch: Record<string, unknown> = {};
    if (lead.stage && EARLY_STAGES.has(lead.stage)) patch.stage = "outreached";
    // Show the thread in the Inbox, without overriding a needs_reply / snoozed / closed flag.
    if (!lead.inbox_status || lead.inbox_status === "none") patch.inbox_status = "open";
    if (Object.keys(patch).length) await db.from("leads").update(patch).eq("id", lead.id);
  },
  scheduleFollowUps: async (lead, plan) => {
    const { error } = await getDb().from("leads").update(followUpPatch(plan)).eq("id", lead.id);
    if (!error) {
      log.info({ lead_id: lead.id, follow_ups: plan.followUps.length }, "send_simple.follow_ups_scheduled");
      return { scheduled: true };
    }
    if (isMissingColumn(error, "seq_max_step") || isMissingColumn(error, "seq_copy_overrides")) {
      return { scheduled: false, note: "The follow-ups weren't scheduled: database update 060 isn't applied yet." };
    }
    log.warn({ lead_id: lead.id, err: error.message }, "send_simple.follow_ups_failed");
    return { scheduled: false, note: "The follow-ups couldn't be scheduled. Try again from the lead page." };
  },
};
