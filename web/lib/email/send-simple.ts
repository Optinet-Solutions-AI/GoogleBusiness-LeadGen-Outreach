/**
 * email/send-simple.ts — send ONE plain email to a lead, written by the operator (no pitch, no follow-ups).
 *
 * Inputs:  lead id, { subject, body (plain text), senderEmail? }; the lead row, its suppression + verification
 *          state, the active mailboxes
 * Outputs: the email goes out now through Ongage from a connected mailbox; an email_messages row (Inbox thread),
 *          an outreach_events 'email_sent' {manual:true} row (CRM timeline), stage → outreached when earlier.
 *          Returns { sent:true, via, checked } or { sent:false, reason, message } — never throws for a refusal.
 * Used by: app/api/leads/[id]/send-email/route.ts (the lead page "Send email" button)
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
import type { VerifyStatus } from "@/lib/services/email-validator/types";

const log = getLogger("send-simple");

export type SimpleSendRefusal = "paused" | "not_configured" | "no_email" | "suppressed" | "bad_address" | "unconfirmed" | "no_mailbox" | "send_failed";

export const SIMPLE_SEND_TEXT: Record<SimpleSendRefusal, string> = {
  paused: "All email sending is paused right now (kill switch). Nothing was sent.",
  not_configured: "Sending isn't switched on for this server (the Ongage settings are missing). Nothing was sent.",
  no_email: "This lead has no email address. Add one first.",
  suppressed: "This lead unsubscribed or is on the do-not-contact list, so it can't be emailed.",
  bad_address: "This address failed the email check. Fix or replace it, then try again.",
  unconfirmed:
    "The email checker couldn't confirm this address, so nothing was sent (unconfirmed addresses hurt the mailbox's reputation). Fix the address or find another one.",
  no_mailbox: "No sending mailbox is connected. Connect one on the Email page first.",
  send_failed: "The email didn't go out.",
};

const EARLY_STAGES = new Set(["scraped", "enriched", "generated", "deployed", "needs_email"]);

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

export interface SimpleSendDeps {
  paused: () => boolean;
  configured: () => boolean;
  load: (id: string) => Promise<SimpleLead | null>;
  suppressed: (lead: SimpleLead) => Promise<boolean>;
  verificationOn: () => boolean;
  verify: (lead: { id: string; email: string }) => Promise<{ status: string } | null>;
  account: (senderEmail?: string | null) => Promise<Account | null>;
  send: (account: Account, to: string, subject: string, html: string) => Promise<{ success: true; messageId: string } | { success: false; error: string }>;
  record: (lead: SimpleLead, sent: { via: string; messageId: string; subject: string; body: string }) => Promise<void>;
}

export type SimpleSendResult =
  | { sent: true; via: string; checked: boolean }
  | { sent: false; reason: SimpleSendRefusal; message: string; checked: boolean };

function refuse(reason: SimpleSendRefusal, checked = false, detail?: string): SimpleSendResult {
  return { sent: false, reason, message: detail ? `${SIMPLE_SEND_TEXT[reason]} ${detail}` : SIMPLE_SEND_TEXT[reason], checked };
}

export async function sendSimpleEmail(
  leadId: string,
  input: { subject: string; body: string; senderEmail?: string | null },
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
  if (deps.verificationOn() && needsCheck(status)) {
    const r = await deps.verify({ id: lead.id, email: lead.email });
    if (r) {
      status = r.status;
      checked = true;
    }
  }
  const decision = sendDecision(status as VerifyStatus | null, deps.verificationOn());
  if (decision === "skip") return refuse("bad_address", checked);
  if (decision === "hold") return refuse("unconfirmed", checked);

  const account = await deps.account(input.senderEmail);
  if (!account) return refuse("no_mailbox", checked);

  const res = await deps.send(account, lead.email, input.subject.trim(), textToHtml(input.body));
  if (!res.success) {
    log.warn({ lead_id: leadId, err: res.error }, "send_simple.failed");
    return refuse("send_failed", checked, res.error);
  }
  await deps.record(lead, { via: account.email, messageId: res.messageId, subject: input.subject.trim(), body: input.body.trim() });
  log.info({ lead_id: leadId, via: account.email }, "send_simple.sent");
  return { sent: true, via: account.email, checked };
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
};
