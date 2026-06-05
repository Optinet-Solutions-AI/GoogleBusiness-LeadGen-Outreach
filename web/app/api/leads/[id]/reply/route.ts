/**
 * api/leads/[id]/reply/route.ts — POST: reply to a lead's email thread from the Inbox.
 *
 * Inputs:  params.id + body { body: string, senderEmail?: which mailbox }
 * Outputs: { sent, via, messageId } | fail(reason)
 * Used by: components/InboxReply.tsx on /inbox/[id].
 *
 * Sends a real reply via the chosen (or first active) mailbox, threading it to
 * the latest message (In-Reply-To + "Re:" subject), records the outbound row in
 * email_messages so the thread updates, and clears a 'needs_reply' flag. Honors
 * the global kill switch; bypasses the warm-up cap (operator-initiated 1:1 reply).
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getSenderAccount } from "@/lib/services/email-sender";
import { sendEmailSmtp } from "@/lib/services/smtp-sender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  body: z.string().min(1, "Write a reply first"),
  senderEmail: z.string().optional(),
});

/** Escape + wrap plain text as simple HTML (newlines → <br>). */
function textToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const { body, senderEmail } = parsed.data;

  // Global kill switch (deliverability incidents).
  const pausedUntil = process.env.EMAIL_SENDING_PAUSED_UNTIL;
  if (pausedUntil && Date.parse(pausedUntil) > Date.now()) {
    return fail(`Email sending is paused until ${pausedUntil}.`, 409);
  }

  const db = getDb();
  const { data: lead } = await db
    .from("leads")
    .select("id,business_name,email,inbox_status")
    .eq("id", params.id)
    .maybeSingle();
  if (!lead) return fail("Lead not found", 404);
  if (!lead.email) return fail("This lead has no email address to reply to.", 400);

  // Latest message in the thread → subject (Re:) + In-Reply-To for proper threading.
  const { data: last } = await db
    .from("email_messages")
    .select("message_id,subject")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const baseSubject = (last?.subject ?? `Following up — ${lead.business_name}`).trim();
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;
  const inReplyTo = last?.message_id ?? undefined;

  const account = await getSenderAccount(senderEmail).catch(() => null);
  if (!account) return fail("No active mailbox to send from. Connect one on Email accounts.", 404);

  const html = textToHtml(body);
  const res = await sendEmailSmtp(lead.email, subject, html, { inReplyTo }, account);
  if (!res.success) return fail(res.error, 502);

  // Record our side of the thread.
  await db.from("email_messages").insert({
    lead_id: lead.id,
    direction: "outbound",
    message_id: res.messageId,
    in_reply_to: inReplyTo ?? null,
    from_addr: account.email,
    to_addr: lead.email,
    subject,
    body_text: body,
    body_snippet: body.slice(0, 200),
    status: "sent",
  });

  // Clear the "needs reply" flag — we've responded.
  if (lead.inbox_status === "needs_reply") {
    await db.from("leads").update({ inbox_status: "open" }).eq("id", lead.id);
  }

  await db.from("outreach_events").insert({
    lead_id: lead.id,
    kind: "email_reply_sent",
    meta: { message_id: res.messageId, to: lead.email, via: account.email },
  });

  return ok({ sent: true, via: account.email, messageId: res.messageId });
});
