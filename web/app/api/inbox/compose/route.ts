/**
 * api/inbox/compose/route.ts — POST: send a fresh (non-reply) email to a lead.
 *
 * Inputs:  { lead_id, subject, body, senderEmail? }
 * Outputs: { sent, via, messageId }
 * Used by: the inbox "Compose new" modal.
 *
 * Unlike /reply this starts a NEW thread (no In-Reply-To). Records the outbound
 * row so it shows in the thread, opens the inbox conversation, honors the kill
 * switch. Operator-initiated 1:1 — bypasses warm-up caps.
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
  lead_id: z.string().uuid(),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Write a message first"),
  senderEmail: z.string().optional(),
});

function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n");
}

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const { lead_id, subject, body, senderEmail } = parsed.data;

  const pausedUntil = process.env.EMAIL_SENDING_PAUSED_UNTIL;
  if (pausedUntil && Date.parse(pausedUntil) > Date.now()) {
    return fail(`Email sending is paused until ${pausedUntil}.`, 409);
  }

  const db = getDb();
  const { data: lead } = await db.from("leads").select("id,email").eq("id", lead_id).maybeSingle();
  if (!lead) return fail("Lead not found", 404);
  if (!lead.email) return fail("This lead has no email address.", 400);

  const account = await getSenderAccount(senderEmail).catch(() => null);
  if (!account) return fail("No active mailbox to send from. Connect one on Email accounts.", 404);

  const res = await sendEmailSmtp(lead.email, subject, textToHtml(body), {}, account);
  if (!res.success) return fail(res.error, 502);

  await db.from("email_messages").insert({
    lead_id,
    direction: "outbound",
    message_id: res.messageId,
    from_addr: account.email,
    to_addr: lead.email,
    subject,
    body_text: body,
    body_snippet: body.slice(0, 200),
    status: "sent",
  });
  await db.from("leads").update({ inbox_status: "open", inbox_read_at: new Date().toISOString() }).eq("id", lead_id);
  await db.from("outreach_events").insert({
    lead_id,
    kind: "email_reply_sent",
    meta: { message_id: res.messageId, to: lead.email, via: account.email, compose: true },
  });

  return ok({ sent: true, via: account.email, messageId: res.messageId });
});
