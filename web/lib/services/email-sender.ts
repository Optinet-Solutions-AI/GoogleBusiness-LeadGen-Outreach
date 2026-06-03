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

import "server-only";
import { getDb } from "../db";
import { getLogger } from "../logger";
import { sendEmailSmtp, type SmtpSenderAccount } from "./smtp-sender";

const log = getLogger("email-sender");

export interface EmailSendResult {
  sent: boolean;
  noop: boolean;
  messageId: string | null;
  error?: string;
}

async function getActiveAccount(): Promise<SmtpSenderAccount | null> {
  const { data } = await getDb()
    .from("email_accounts")
    .select("email,from_name,smtp_host,smtp_port,smtp_user,smtp_password,imap_host,imap_port,imap_user,imap_pass,status")
    .eq("status", "active")
    .not("smtp_host", "is", null)
    .limit(1)
    .maybeSingle();
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
  };
}

export async function sendOutreachEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<EmailSendResult> {
  const account = await getActiveAccount().catch(() => null);
  if (!account) {
    log.info({ to: input.to, noop: true }, "email_sender.noop (no active mailbox connected)");
    return { sent: true, noop: true, messageId: `noop:${input.to}` };
  }
  const res = await sendEmailSmtp(input.to, input.subject, input.html, {}, account);
  if (res.success) {
    log.info({ to: input.to, messageId: res.messageId }, "email_sender.sent");
    return { sent: true, noop: false, messageId: res.messageId };
  }
  log.warn({ to: input.to, err: res.error }, "email_sender.failed");
  return { sent: false, noop: false, messageId: null, error: res.error };
}
