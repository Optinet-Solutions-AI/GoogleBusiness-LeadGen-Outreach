/**
 * email-reader.ts — Read inbound replies from a connected mailbox over IMAP.
 *
 * Inputs:  an ImapAccount (host/port/user/pass) + the last UID we've already seen
 * Outputs: { messages, maxUid } — new inbound emails parsed to readable text
 * Used by: app/api/email/sync/route.ts (poll → match to lead → store)
 *
 * Mirrors the IMAP connection used in /api/email-accounts/bluehost (verification).
 * Incremental: fetch UID > sinceUid; on first run, fetch the most recent window.
 * Never throws raw connection noise into the caller — connection errors propagate
 * as Errors the route catches per account.
 */

import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getLogger } from "../logger";

const log = getLogger("email-reader");

export interface ImapAccount {
  id: string;
  email: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_user: string | null;
  imap_pass: string | null;
}

export interface InboundEmail {
  uid: string;
  from: string;
  fromName: string | null;
  subject: string;
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Lowercased header name → value (for the auto-reply classifier). */
  headers: Record<string, string>;
  date: string;
}

/** On first sync (no UID yet), only look at the most recent N messages. */
const RECENT_WINDOW = 40;

export async function fetchReplies(
  account: ImapAccount,
  sinceUid: number | null,
): Promise<{ messages: InboundEmail[]; maxUid: number }> {
  if (!account.imap_host || !account.imap_user || !account.imap_pass) {
    return { messages: [], maxUid: sinceUid ?? 0 };
  }

  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port ?? 993,
    secure: true,
    auth: { user: account.imap_user, pass: account.imap_pass },
    logger: false,
    connectionTimeout: 15_000,
  });

  const messages: InboundEmail[] = [];
  let maxUid = sinceUid ?? 0;

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const incremental = !!(sinceUid && sinceUid > 0);
    let range: string;
    if (incremental) {
      range = `${sinceUid + 1}:*`;
    } else {
      const mb = client.mailbox;
      const total = mb && typeof mb !== "boolean" ? mb.exists : 0;
      const start = Math.max(1, total - (RECENT_WINDOW - 1));
      range = `${start}:*`;
    }

    for await (const msg of client.fetch(
      range,
      { uid: true, envelope: true, source: true },
      { uid: incremental },
    )) {
      if (typeof msg.uid === "number") maxUid = Math.max(maxUid, msg.uid);
      if (!msg.source) continue;

      let parsed;
      try {
        parsed = await simpleParser(msg.source);
      } catch (e) {
        log.warn({ uid: msg.uid, err: (e as Error).message }, "email_reader.parse_failed");
        continue;
      }

      const fromVal = parsed.from?.value?.[0];
      const refsRaw = parsed.references;
      const references = Array.isArray(refsRaw) ? refsRaw : refsRaw ? [refsRaw] : [];
      const headers: Record<string, string> = {};
      for (const hl of parsed.headerLines ?? []) {
        const idx = hl.line.indexOf(":");
        if (idx > 0) headers[hl.key.toLowerCase()] = hl.line.slice(idx + 1).trim();
      }
      messages.push({
        uid: String(msg.uid),
        from: (fromVal?.address ?? "").toLowerCase(),
        fromName: fromVal?.name ?? null,
        subject: parsed.subject ?? "(no subject)",
        text: (parsed.text ?? "").trim(),
        messageId: parsed.messageId ?? null,
        inReplyTo: typeof parsed.inReplyTo === "string" ? parsed.inReplyTo : null,
        references,
        headers,
        date: (parsed.date ?? new Date()).toISOString(),
      });
    }
  } finally {
    lock.release();
    try {
      await client.logout();
    } catch {
      /* ignore logout errors */
    }
  }

  log.info({ account: account.email, fetched: messages.length, maxUid }, "email_reader.done");
  return { messages, maxUid };
}
