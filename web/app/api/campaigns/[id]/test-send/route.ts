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
import { renderSequenceEmail, variantFor, maxStepForVariant } from "@/lib/email/sequence-templates";
import { resolveSegment, type CallSegment } from "@/lib/segment";

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
    .select("id,channel,segment,copy_overrides")
    .eq("id", params.id)
    .maybeSingle();
  if (!camp) return fail("Campaign not found", 404);
  if (camp.channel !== "email") return fail("Test send is for email campaigns only.", 400);

  // Use a real member as the sample (realistic tokens); fall back to a placeholder.
  const { data: member } = await db
    .from("campaign_leads")
    .select("leads(business_name,demo_url,call_segment,website_kind,needs_improvement)")
    .eq("campaign_id", camp.id)
    .limit(1)
    .maybeSingle();
  type Sample = {
    business_name: string; demo_url: string | null; call_segment: string | null;
    website_kind: string | null; needs_improvement: boolean | null;
  };
  const memberLead = (member as unknown as { leads: Sample | null } | null)?.leads;
  const sample: Sample = memberLead ?? {
    business_name: "Sample Business", demo_url: null, call_segment: null,
    website_kind: null, needs_improvement: null,
  };

  const account = await getSenderAccount(senderEmail).catch(() => null);
  if (!account) {
    return ok({ sent: false, noMailbox: true });
  }

  // Render the REAL sequence step 1 (what actually sends), not the legacy single
  // email. Resolve the segment the same way the scheduler does.
  const segment: CallSegment = (camp.segment as CallSegment | null) ?? resolveSegment(sample);
  const total = maxStepForVariant(variantFor(segment));
  const overrides = (camp.copy_overrides ?? null) as Record<string, { subject?: string | null; body?: string | null }> | null;
  const { subject, html } = renderSequenceEmail(
    { business_name: sample.business_name, demo_url: sample.demo_url, call_segment: segment },
    1,
    overrides?.["1"] ?? null,
  );
  const res = await sendEmailSmtp(to, `[TEST step 1/${total}] ${subject}`, html, {}, account);
  if (!res.success) return fail(res.error, 502);
  return ok({ sent: true, to, via: account.email });
});
