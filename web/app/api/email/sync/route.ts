/**
 * api/email/sync/route.ts — POST: pull inbound replies from connected mailboxes.
 *
 * For each active email_account with IMAP creds: fetch new messages (UID cursor),
 * match each sender to a lead by email, store NEW inbound rows in email_messages,
 * flag the lead inbox_status='needs_reply', and log an outreach_event. Advances
 * the per-mailbox UID cursor so repeat calls are cheap + idempotent.
 *
 * Reading only — never sends. Safe to call manually (Inbox "Sync replies") or on a cron.
 */

import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fetchReplies, type ImapAccount } from "@/lib/services/email-reader";
import { classifyReply } from "@/lib/services/auto-reply-detector";
import { getLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("api.email.sync");

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

export const POST = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const db = getDb();

  const { data: accounts, error } = await db
    .from("email_accounts")
    .select("id,email,imap_host,imap_port,imap_user,imap_pass,imap_last_uid,status")
    .eq("status", "active")
    .not("imap_host", "is", null);
  if (error) return fail(error.message, 502);

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
            log.warn({ err: insErr.message }, "email_sync.insert_failed");
          }
          continue;
        }

        accStored += 1;
        stored += 1;

        // Classify so an out-of-office / auto-reply doesn't fake a hot lead,
        // and an "unsubscribe" reply suppresses future email.
        const verdict = classifyReply({ headers: m.headers, subject: m.subject, body: m.text });
        if (verdict.isUnsubscribe) {
          await db.from("leads").update({ lifecycle_stage: "unsubscribed" }).eq("id", leadId);
          await stopSequenceIfActive(db, leadId);
          await db
            .from("outreach_events")
            .insert({ lead_id: leadId, kind: "email_unsubscribe", meta: { from: m.from, subject: m.subject } });
        } else if (verdict.kind === "human") {
          await db.from("leads").update({ inbox_status: "needs_reply" }).eq("id", leadId);
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
      log.warn({ account: acc.email, err: msg }, "email_sync.account_failed");
      perAccount.push({ email: acc.email, fetched: 0, stored: 0, error: msg });
    }
  }

  log.info({ fetched, matched, stored, accounts: perAccount.length }, "email_sync.done");
  return ok({ accounts: perAccount, fetched, matched, stored });
});
