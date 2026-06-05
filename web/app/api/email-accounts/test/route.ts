/**
 * api/email-accounts/test/route.ts — POST: send ONE real test email from a
 * connected mailbox to prove the SMTP path works (campaign-free).
 *
 * Inputs:  body { email: sender mailbox, to: where to send the test }
 * Outputs: { sent, via, messageId } | fail(reason)
 * Used by: components/MailboxTestButton.tsx on the Email accounts page.
 *
 * Sends through the SAME path campaigns use (getSenderAccount + sendEmailSmtp),
 * so a successful delivery proves real sending works. Honors the global kill
 * switch; bypasses the daily cap (it's a manual test to your own inbox) and does
 * NOT write an outreach/email_messages row.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getSenderAccount } from "@/lib/services/email-sender";
import { sendEmailSmtp } from "@/lib/services/smtp-sender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(), // which connected mailbox sends
  to: z.string().email(), // where the test lands
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("A sender mailbox and a valid 'to' email are required", 400);
  const { email, to } = parsed.data;

  // Respect the global kill switch (deliverability incidents).
  const pausedUntil = process.env.EMAIL_SENDING_PAUSED_UNTIL;
  if (pausedUntil && Date.parse(pausedUntil) > Date.now()) {
    return fail(`Email sending is paused until ${pausedUntil}.`, 409);
  }

  const account = await getSenderAccount(email).catch(() => null);
  if (!account) return fail(`No active mailbox with SMTP credentials for ${email}.`, 404);

  const subject = "Test email from your lead-gen app";
  const html =
    `<p>This is a test confirming <strong>${account.email}</strong> can send through your lead-gen app.</p>` +
    `<p>If this landed in your inbox, the mailbox is wired correctly and ready for campaigns.</p>`;

  const res = await sendEmailSmtp(to, subject, html, {}, account);
  if (!res.success) return fail(res.error, 502);
  return ok({ sent: true, via: account.email, messageId: res.messageId });
});
