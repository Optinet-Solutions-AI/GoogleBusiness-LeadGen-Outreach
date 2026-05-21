/**
 * smtp-sender.ts — Send email via SMTP + IMAP-append to Sent folder.
 *
 * Inputs:  recipient, subject, html body, optional screenshot, SmtpSenderAccount
 * Outputs: { success, messageId } or { success: false, error }
 * Used by: any scheduler / ad-hoc script that dispatches via a connected mailbox
 */

import type { Transporter, SendMailOptions } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { getLogger } from "../logger";

const log = getLogger("smtp-sender");

export interface SmtpSenderAccount {
  email: string;
  fromName?: string | null;
  auth_type: "smtp";
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_user?: string | null;
  imap_pass?: string | null;
}

// One pooled transporter per smtp_user — created once, reused per account.
const pool = new Map<string, Transporter>();

async function getTransporter(account: SmtpSenderAccount): Promise<Transporter> {
  const key = account.smtp_user;
  if (!pool.has(key)) {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.smtp_user, pass: account.smtp_password },
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
    });
    pool.set(key, t);
  }
  return pool.get(key)!;
}

async function fetchBufferWithRetry(
  urlOrPath: string,
  attempts = 3,
): Promise<Buffer | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(urlOrPath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (e) {
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000));
      else {
        log.warn({ url: urlOrPath, err: (e as Error).message }, "smtp.screenshot.fetch_failed");
        return null;
      }
    }
  }
  return null;
}

async function appendToSentFolder(
  account: SmtpSenderAccount,
  mailOptions: SendMailOptions,
): Promise<void> {
  if (!account.imap_host || !account.imap_user || !account.imap_pass) {
    log.warn({ email: account.email }, "smtp.imap.no_creds");
    return;
  }

  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port ?? 993,
    secure: true,
    auth: { user: account.imap_user, pass: account.imap_pass },
    logger: false,
    connectionTimeout: 10_000,
  });

  try {
    await client.connect();

    // Build raw MIME
    const MailComposer = (await import("nodemailer/lib/mail-composer")).default;
    const raw: Buffer = await new Promise((resolve, reject) => {
      new MailComposer(mailOptions).compile().build((err, buf) => {
        if (err) reject(err);
        else resolve(buf);
      });
    });

    const boxes = await client.list();
    const sentBox =
      boxes.find((b) => b.specialUse === "\\Sent") ??
      boxes.find((b) => /^sent$/i.test(b.name)) ??
      boxes.find((b) => /^sent\.messages$/i.test(b.name)) ??
      boxes.find((b) => /^sent\.items$/i.test(b.name)) ??
      boxes.find((b) => /sent/i.test(b.name));

    if (!sentBox) {
      log.warn({ email: account.email }, "smtp.imap.no_sent_folder");
      return;
    }

    await client.append(sentBox.path, raw, ["\\Seen"]);
    log.info({ email: account.email, folder: sentBox.path }, "smtp.imap.appended");
  } catch (e) {
    log.warn({ email: account.email, err: (e as Error).message }, "smtp.imap.append_failed");
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

export async function sendEmailSmtp(
  to: string,
  subject: string,
  html: string,
  options: { screenshotPath?: string },
  account: SmtpSenderAccount,
): Promise<{ success: true; messageId: string } | { success: false; error: string }> {
  try {
    const host = account.email.split("@")[1] || "localhost";
    const messageId = `<${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@${host}>`;

    let bodyHtml = html;
    const attachments: Mail.Attachment[] = [];

    if (options.screenshotPath) {
      const buf = await fetchBufferWithRetry(options.screenshotPath);
      if (buf) {
        attachments.push({
          filename: "screenshot.png",
          content: buf,
          cid: "inline-screenshot",
        });
        bodyHtml += `<br><img src="cid:inline-screenshot" style="max-width:100%">`;
      }
    }

    const fromName = account.fromName || account.email;
    const mailOptions = {
      from: `"${fromName}" <${account.email}>`,
      to,
      subject,
      html: bodyHtml,
      messageId,
      attachments,
    };

    const transporter = await getTransporter(account);
    await transporter.sendMail(mailOptions);
    log.info({ to, messageId }, "smtp.sent");

    // Fire-and-forget IMAP append — never fail the send
    appendToSentFolder(account, mailOptions).catch((e) =>
      log.warn({ err: (e as Error).message }, "smtp.imap.append_error"),
    );

    return { success: true, messageId };
  } catch (e) {
    const err = (e as Error).message;
    log.error({ to, err }, "smtp.send_failed");
    return { success: false, error: err };
  }
}
