/**
 * api/campaigns/[id]/test-send/route.ts — POST: send ONE test email immediately.
 *
 * Inputs:  params.id + body { to: email, senderEmail?: which mailbox }
 * Outputs: { sent, to, via } | { sent:false, noMailbox:true }
 * Used by: the email-campaign controls "Send test" button — a pre-flight check
 *          before going live (mirrors the blueprint's mandatory test flight).
 *
 * Renders the EXACT campaign email (a real member is used as the sample when one
 * exists, for realistic tokens), prefixes the subject with [TEST], and sends via
 * the chosen sender. Bypasses the daily cap (it's to your own inbox) and does NOT
 * write a real outreach/email_messages row.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getSenderAccount } from "@/lib/services/email-sender";
import { sendEmailSmtp } from "@/lib/services/smtp-sender";
import { renderOutreachEmail, type EmailLead } from "@/lib/pipeline/stage-5-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  to: z.string().email(),
  senderEmail: z.string().optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("A valid 'to' email address is required", 400);
  const { to, senderEmail } = parsed.data;

  const db = getDb();
  const { data: camp } = await db
    .from("call_campaigns")
    .select("id,channel")
    .eq("id", params.id)
    .maybeSingle();
  if (!camp) return fail("Campaign not found", 404);
  if (camp.channel !== "email") return fail("Test send is for email campaigns only.", 400);

  // Use a real member as the sample (realistic tokens); fall back to a placeholder.
  const { data: member } = await db
    .from("campaign_leads")
    .select("leads(id,business_name,email,primary_offer,demo_url)")
    .eq("campaign_id", camp.id)
    .limit(1)
    .maybeSingle();
  const memberLead = (member as unknown as { leads: EmailLead | null } | null)?.leads;
  const sampleLead: EmailLead = memberLead ?? {
    id: "sample",
    business_name: "Sample Business",
    email: to,
    demo_url: null,
    primary_offer: null,
  };

  const account = await getSenderAccount(senderEmail).catch(() => null);
  if (!account) {
    return ok({ sent: false, noMailbox: true });
  }

  const { subject, html } = renderOutreachEmail(sampleLead);
  const res = await sendEmailSmtp(to, `[TEST] ${subject}`, html, {}, account);
  if (!res.success) return fail(res.error, 502);
  return ok({ sent: true, to, via: account.email });
});
