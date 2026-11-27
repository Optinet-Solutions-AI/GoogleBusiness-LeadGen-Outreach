/**
 * inbox-sync.ts — Pull inbound replies from connected mailboxes (IMAP). Shared.
 *
 * Inputs:  none (reads active AND paused email_accounts with IMAP creds + their UID cursor)
 * Outputs: { accounts, fetched, matched, stored } — and side effects: new inbound
 *          email_messages rows, lead inbox_status/lifecycle_stage updates, a human reply moves the lead to
 *          stage 'replied' (stageAfterReply, never backwards; + lead_stage_events for the CRM timeline),
 *          sequence stops on reply/bounce/unsubscribe, advanced UID cursor.
 * Used by: app/api/email/sync (manual "Sync replies") + the Cloud Run job
 *          MODE=inbox (automatic poll via Cloud Scheduler).
 *
 * AI reply handling (27 Nov 2026, migration 078): a human reply is marked ai_state 'pending'; with { draft: true }
 * (the Cloud Run tick only — the manual Sync on Vercel has a 60 s limit) the pending ones are then sorted and drafted
 * (lib/email/reply-ai-run.ts draftPending). The AI never sends anything.
 *
 * Reading only — never sends. Idempotent: dedupes by (mailbox, UID).
 */

import { getDb } from "@/lib/db";
import { fetchReplies, type ImapAccount } from "@/lib/services/email-reader";
import { classifyReply } from "@/lib/services/auto-reply-detector";
import { getLogger } from "@/lib/logger";
import { stageAfterReply } from "@/lib/crm/board";
import { pickReplyLead, type OutboundRef } from "@/lib/email/reply-match";
import { draftPending } from "@/lib/email/reply-ai-run";
import { recordStageEvent } from "@/lib/lead-stage";

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
  /** The AI drafting pass (only with { draft: true }). */
  drafts?: Awaited<ReturnType<typeof draftPending>> | { error: string };
}

export async function runInboxSync(opts: { draft?: boolean } = {}): Promise<InboxSyncSummary> {
  const db = getDb();

  const { data: accounts, error } = await db
    .from("email_accounts")
    .select("id,email,imap_host,imap_port,imap_user,imap_pass,imap_last_uid,status")
    // Paused mailboxes too (auto-pause, 27 Nov 2026): a reply / bounce / unsubscribe to them must still stop the lead.
    .in("status", ["active", "paused"])
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

      // Every lead per sender address (one address can be on several leads), plus what we sent to that address, so
      // pickReplyLead can choose the lead we actually emailed (Ongage swaps our Message-ID, so In-Reply-To rarely helps).
      const leadsByEmail = new Map<string, string[]>();
      const outboundTo = new Map<string, OutboundRef[]>();
      if (senders.length > 0) {
        const { data: leads } = await db.from("leads").select("id,email").in("email", senders).limit(2000);
        for (const l of (leads ?? []) as { id: string; email: string | null }[]) {
          if (!l.email) continue;
          const k = l.email.toLowerCase();
          leadsByEmail.set(k, [...(leadsByEmail.get(k) ?? []), l.id]);
        }
        const { data: sent } = await db
          .from("email_messages")
          .select("lead_id,to_addr,subject,email_account_id,created_at")
          .eq("direction", "outbound")
          .in("to_addr", senders)
          .order("created_at", { ascending: false })
          .limit(3000);
        for (const o of (sent ?? []) as (OutboundRef & { to_addr: string | null })[]) {
          if (!o.to_addr || !o.lead_id) continue;
          const k = o.to_addr.toLowerCase();
          outboundTo.set(k, [...(outboundTo.get(k) ?? []), o]);
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
        // Resolve the lead: the email it answers (In-Reply-To, then References), else among the leads with the
        // sender's address, the one we emailed (same subject, same mailbox, most recent).
        let leadId: string | null | undefined = m.inReplyTo ? leadByMsgId.get(normId(m.inReplyTo)) : undefined;
        if (!leadId) {
          for (const r of m.references) {
            const lid = leadByMsgId.get(normId(r));
            if (lid) {
              leadId = lid;
              break;
            }
          }
        }
        if (!leadId) {
          const from = (m.from ?? "").toLowerCase();
          leadId = pickReplyLead({ subject: m.subject, accountId: acc.id }, leadsByEmail.get(from) ?? [], outboundTo.get(from) ?? []);
        }
        if (!leadId) continue; // not one of our leads — skip
        matched += 1;

        const { data: inserted, error: insErr } = await db.from("email_messages").insert({
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
        }).select("id").maybeSingle();

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
          // Real reply → needs a response, and mark UNREAD so it stands out. It also moves the lead to Replied
          // (Leads list + CRM), like an interested AI call; never backwards.
          const { data: cur } = await db.from("leads").select("stage").eq("id", leadId).maybeSingle();
          const fromStage = (cur as { stage: string | null } | null)?.stage ?? null;
          const toStage = stageAfterReply(fromStage);
          const base = { inbox_status: "needs_reply", inbox_read_at: null, ...(toStage ? { stage: toStage } : {}) };
          // + 078: when they replied, and the AI hasn't read this reply yet (the Brain waits for it).
          // When it came: the header date, but never in the future (a wrong clock can't hold the Brain open).
          const replyAt = new Date(Math.min(Date.parse(m.date) || Date.now(), Date.now())).toISOString();
          const { error: upErr } = await db.from("leads").update({ ...base, last_reply_at: replyAt, reply_category: null }).eq("id", leadId);
          if (upErr) await db.from("leads").update(base).eq("id", leadId);
          // The AI sorts it and writes a draft on the next inbox tick (078; ignored without it).
          const msgId = (inserted as { id?: string } | null)?.id;
          if (msgId) await db.from("email_messages").update({ ai_state: "pending" }).eq("id", msgId);
          if (toStage) await recordStageEvent(leadId, toStage, fromStage);
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
  const summary: InboxSyncSummary = { accounts: perAccount, fetched, matched, stored };
  if (opts.draft) {
    try {
      summary.drafts = await draftPending();
    } catch (err) {
      summary.drafts = { error: String(err).slice(0, 200) };
      log.warn({ err: String(err) }, "inbox_sync.drafting_failed");
    }
  }
  return summary;
}
