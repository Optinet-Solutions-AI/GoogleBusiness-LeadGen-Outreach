/**
 * email-sender.ts — Send an outreach email through a connected mailbox (SMTP).
 *
 * Inputs:  { to, subject, html }
 * Outputs: { sent, noop, messageId } — never throws into the caller
 * Used by: lib/pipeline/stage-5-email.ts
 *
 * SOFT NO-OP: with no active row in `email_accounts` (or missing SMTP creds), this does NOT send —
 * it logs and returns a fake id with sent=true (mirrors mobivate.ts). So the email channel runs
 * end-to-end at $0 before a real mailbox is connected. Picks the first active account; warmup/
 * rotation across multiple senders is a later enhancement.
 */

import "@/lib/server-guard";
import { getDb } from "../db";
import { getLogger } from "../logger";
import { sendEmailSmtp, type SmtpSenderAccount } from "./smtp-sender";

const log = getLogger("email-sender");

export interface EmailSendResult {
  sent: boolean;
  noop: boolean;
  messageId: string | null;
  error?: string;
  /** Set when a send was deliberately not attempted. */
  reason?: "paused" | "capped";
}

type ActiveAccount = SmtpSenderAccount & {
  daily_cap: number | null;
  warmup_started_at: string | null;
  warmup_target_cap: number | null;
  warmup_ramp_days: number | null;
};

/**
 * Pick the sending mailbox. With `senderEmail`, returns that specific active
 * mailbox (the campaign's chosen sender); otherwise the first active one.
 * Exported so the campaign test-send can resolve the same account.
 */
export async function getSenderAccount(senderEmail?: string | null): Promise<ActiveAccount | null> {
  let q = getDb()
    .from("email_accounts")
    .select(
      "email,from_name,smtp_host,smtp_port,smtp_user,smtp_password,imap_host,imap_port,imap_user,imap_pass,status,daily_cap,warmup_started_at,warmup_target_cap,warmup_ramp_days",
    )
    .eq("status", "active")
    .not("smtp_host", "is", null);
  if (senderEmail) q = q.eq("email", senderEmail);
  const { data } = await q.limit(1).maybeSingle();
  if (!data?.smtp_host || !data?.smtp_user || !data?.smtp_password) return null;
  return {
    email: data.email,
    fromName: data.from_name,
    auth_type: "smtp",
    smtp_host: data.smtp_host,
    smtp_port: data.smtp_port ?? 587,
    smtp_user: data.smtp_user,
    smtp_password: data.smtp_password,
    imap_host: data.imap_host,
    imap_port: data.imap_port,
    imap_user: data.imap_user,
    imap_pass: data.imap_pass,
    daily_cap: data.daily_cap ?? null,
    warmup_started_at: data.warmup_started_at ?? null,
    warmup_target_cap: data.warmup_target_cap ?? null,
    warmup_ramp_days: data.warmup_ramp_days ?? null,
  };
}

/**
 * Effective daily cap for a sending mailbox, ramped over its warm-up window
 * (email-sending-system.md §6.4). Don't blast a cold mailbox from day one.
 */
export function getRampedDailyCap(acc: ActiveAccount): number {
  const target = acc.warmup_target_cap ?? acc.daily_cap ?? 50;
  if (!acc.warmup_started_at) return acc.daily_cap ?? target;
  const start = Date.parse(acc.warmup_started_at);
  if (Number.isNaN(start)) return acc.daily_cap ?? target;
  const dayN = Math.floor((Date.now() - start) / 86_400_000) + 1;
  const rampDays = acc.warmup_ramp_days ?? 21;
  if (dayN >= Math.max(2, rampDays)) return target;
  const floor = 10;
  return Math.round(floor + (target - floor) * (dayN / rampDays));
}

/**
 * Real outbound sends in the last 24h FOR ONE MAILBOX (excludes $0 soft-no-ops).
 * Per-sender so rotation works: counting all mailboxes would let one cap throttle
 * the whole pool. Matches the scheduler's remainingFor (also counts by from_addr).
 */
async function countSentLast24h(fromAddr: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await getDb()
    .from("email_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound")
    .eq("from_addr", fromAddr)
    .gte("created_at", since)
    .not("message_id", "like", "noop:%");
  return count ?? 0;
}

export async function sendOutreachEmail(input: {
  to: string;
  subject: string;
  html: string;
  senderEmail?: string | null;
  /** URL of a screenshot to inline (CID). Placed at the body's <!--SCREENSHOT-->
   *  marker if present, else appended. Used by the email sequence (step 2). */
  screenshotPath?: string | null;
  /** Threading headers so follow-ups land in the same conversation. */
  inReplyTo?: string | null;
  references?: string[];
}): Promise<EmailSendResult> {
  // Global kill switch — halts all sends while in the future (deliverability incidents).
  const pausedUntil = process.env.EMAIL_SENDING_PAUSED_UNTIL;
  if (pausedUntil && Date.parse(pausedUntil) > Date.now()) {
    log.warn({ until: pausedUntil }, "email_sender.paused");
    return { sent: false, noop: false, messageId: null, reason: "paused" };
  }

  const account = await getSenderAccount(input.senderEmail).catch(() => null);
  if (!account) {
    log.info({ to: input.to, noop: true }, "email_sender.noop (no active mailbox connected)");
    return { sent: true, noop: true, messageId: `noop:${input.to}` };
  }

  // Per-account daily cap (warmup-ramped), enforced from real 24h send history.
  const cap = getRampedDailyCap(account);
  const sent24h = await countSentLast24h(account.email);
  if (sent24h >= cap) {
    log.warn({ email: account.email, sent24h, cap }, "email_sender.capped");
    return { sent: false, noop: false, messageId: null, reason: "capped" };
  }

  const res = await sendEmailSmtp(
    input.to,
    input.subject,
    input.html,
    {
      ...(input.screenshotPath ? { screenshotPath: input.screenshotPath } : {}),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo, references: input.references } : {}),
    },
    account,
  );
  if (res.success) {
    log.info({ to: input.to, messageId: res.messageId }, "email_sender.sent");
    return { sent: true, noop: false, messageId: res.messageId };
  }
  log.warn({ to: input.to, err: res.error }, "email_sender.failed");
  return { sent: false, noop: false, messageId: null, error: res.error };
}
