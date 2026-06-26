/**
 * inbox-sync.ts — Pull inbound replies from connected mailboxes (IMAP). Shared.
 *
 * Inputs:  none (reads active email_accounts with IMAP creds + their UID cursor)
 * Outputs: { accounts, fetched, matched, stored } — and side effects: new inbound
 *          email_messages rows, lead inbox_status/lifecycle_stage updates,
 *          sequence stops on reply/bounce/unsubscribe, advanced UID cursor.
 * Used by: app/api/email/sync (manual "Sync replies") + the Cloud Run job
 *          MODE=inbox (automatic poll via Cloud Scheduler).
 *
 * Reading only — never sends. Idempotent: dedupes by (mailbox, UID).
 */

import { getDb } from "@/lib/db";
import { fetchReplies, type ImapAccount } from "@/lib/services/email-reader";
import { classifyReply } from "@/lib/services/auto-reply-detector";
import { getLogger } from "@/lib/logger";

const log = getLogger("inbox-sync");

/** Normalize a Message-ID for matching (strip angle brackets, lowercase). */
function normId(s: string): string {
  return s.replace(/[<>]/g, "").trim().toLowerCase();
}

/** Halt a running email sequence on reply/unsubscribe (no-op if not active). */
async function stopSequenceIfActive(db: ReturnType<typeof getDb>, leadId: string): Promise<void> {
  await db
    .from("leads")
    .update({ seq_status: "stopped", seq_next_step_at: null })
    .eq("id", leadId)
    .eq("seq_status", "active");
}

type AccountRow = ImapAccount & { imap_last_uid: number | null };

export interface InboxSyncSummary {
  accounts: { email: string; fetched: number; stored: number; error?: string }[];
  fetched: number;
  matched: number;
  stored: number;
}

export async function runInboxSync(): Promise<InboxSyncSummary> {
  const db = getDb();

  const { data: accounts, error } = await db
    .from("email_accounts")
    .select("id,email,imap_host,imap_port,imap_user,imap_pass,imap_last_uid,status")
    .eq("status", "active")
    .not("imap_host", "is", null);
  if (error) throw new Error(error.message);

  let fetched = 0;
  let matched = 0;
  let stored = 0;
  const perAccount: { email: string; fetched: number; stored: number; error?: string }[] = [];

  for (const acc of (accounts ?? []) as AccountRow[]) {
    try {
      const { messages, maxUid } = await fetchReplies(acc, acc.imap_last_uid ?? null);
      fetched += messages.length;

      // Build two match indexes: sender-address → lead, and our outbound
      // Message-IDs → lead (so a reply matches via In-Reply-To / References
      // even when its visible From differs — ticketing systems, aliases).
      const senders = [...new Set(messages.map((m) => m.from).filter(Boolean))];
      const candidateMsgIds = [
        ...new Set(
          messages.flatMap((m) => [m.inReplyTo, ...m.references]).filter(Boolean) as string[],
        ),
      ];

      const leadByEmail = new Map<string, string>();
      if (senders.length > 0) {
        const { data: leads } = await db.from("leads").select("id,email").in("email", senders).limit(2000);
        for (const l of (leads ?? []) as { id: string; email: string | null }[]) {
          if (l.email) leadByEmail.set(l.email.toLowerCase(), l.id);
        }
      }

      const leadByMsgId = new Map<string, string>();
      if (candidateMsgIds.length > 0) {
        const { data: outs } = await db
          .from("email_messages")
          .select("lead_id,message_id")
          .eq("direction", "outbound")
          .in("message_id", candidateMsgIds)
          .limit(3000);
        for (const o of (outs ?? []) as { lead_id: string | null; message_id: string | null }[]) {
          if (o.lead_id && o.message_id) leadByMsgId.set(normId(o.message_id), o.lead_id);
        }
      }

      let accStored = 0;
      for (const m of messages) {
        // Resolve the lead: by sender, else by In-Reply-To, else any References id.
        let leadId = leadByEmail.get(m.from);
        if (!leadId && m.inReplyTo) leadId = leadByMsgId.get(normId(m.inReplyTo));
        if (!leadId) {
          for (const r of m.references) {
            const lid = leadByMsgId.get(normId(r));
            if (lid) {
              leadId = lid;
              break;
            }
          }
        }
        if (!leadId) continue; // not one of our leads — skip
        matched += 1;

        const { error: insErr } = await db.from("email_messages").insert({
          lead_id: leadId,
          email_account_id: acc.id,
          direction: "inbound",
          message_id: m.messageId,
          in_reply_to: m.inReplyTo,
          from_addr: m.from,
          to_addr: acc.email,
          subject: m.subject,
          body_text: m.text,
          body_snippet: m.text.slice(0, 200),
          provider_uid: m.uid,
          status: "received",
          created_at: m.date,
        });

        if (insErr) {
          // 23505 = already stored this (mailbox, uid) — not an error, just skip.
          if ((insErr as { code?: string }).code !== "23505") {
            log.warn({ err: insErr.message }, "inbox_sync.insert_failed");
          }
          continue;
        }

        accStored += 1;
        stored += 1;

        // New inbound reply lands UNREAD in the Gmail-style inbox.
        const verdict = classifyReply({ headers: m.headers, subject: m.subject, body: m.text });
        if (verdict.isBounce) {
          // Non-delivery report: NEVER follow up on a bounced address.
          await db.from("outreach_events").insert({
            lead_id: leadId,
            kind: "email_bounced",
            meta: { from: m.from, subject: m.subject, bounceKind: verdict.bounceKind, signals: verdict.signals },
          });
          if (verdict.bounceKind === "hard") {
            await db.from("leads").update({ verification_status: "invalid" }).eq("id", leadId);
          }
          await stopSequenceIfActive(db, leadId);
        } else if (verdict.isUnsubscribe) {
          await db.from("leads").update({ lifecycle_stage: "unsubscribed" }).eq("id", leadId);
          await stopSequenceIfActive(db, leadId);
          await db
            .from("outreach_events")
            .insert({ lead_id: leadId, kind: "email_unsubscribe", meta: { from: m.from, subject: m.subject } });
        } else if (verdict.kind === "human") {
          // Real reply → needs a response, and mark UNREAD so it stands out.
          await db
            .from("leads")
            .update({ inbox_status: "needs_reply", inbox_read_at: null })
            .eq("id", leadId);
          await stopSequenceIfActive(db, leadId);
          await db
            .from("outreach_events")
            .insert({ lead_id: leadId, kind: "email_reply", meta: { subject: m.subject, from: m.from } });
        } else {
          // auto / ticket — store the message but DON'T flag the lead for follow-up.
          await db.from("outreach_events").insert({
            lead_id: leadId,
            kind: "email_auto_reply",
            meta: { subject: m.subject, from: m.from, classify: verdict.kind, signals: verdict.signals },
          });
        }
      }

      await db
        .from("email_accounts")
        .update({ imap_last_uid: maxUid, imap_last_synced_at: new Date().toISOString() })
        .eq("id", acc.id);

      perAccount.push({ email: acc.email, fetched: messages.length, stored: accStored });
    } catch (e) {
      const msg = (e as Error).message;
      log.warn({ account: acc.email, err: msg }, "inbox_sync.account_failed");
      perAccount.push({ email: acc.email, fetched: 0, stored: 0, error: msg });
    }
  }

  log.info({ fetched, matched, stored, accounts: perAccount.length }, "inbox_sync.done");
  return { accounts: perAccount, fetched, matched, stored };
}
