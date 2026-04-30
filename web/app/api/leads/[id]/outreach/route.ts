/**
 * api/leads/[id]/outreach/route.ts — Operator clicks "Send to outreach".
 *
 * POST /api/leads/:id/outreach
 *   - Validates the lead exists and has demo_url (build must be done first)
 *   - Calls stage 5 (Instantly.ai send) via lib/pipeline/stage-5-outreach
 *   - Reports back: { status: 'outreached' } on send, or
 *                   { status: 'needs_email' } if lead.email is null
 *     (stage 5 itself flips lead.stage to 'needs_email' when email is missing)
 *
 * Re-runs are intentional and safe — operator may add an email after a
 * 'needs_email' miss, or re-send after an Instantly bounce.
 */

import { getDb } from "@/lib/db";
import * as stage5 from "@/lib/pipeline/stage-5-outreach";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";

const log = getLogger("api.leads.outreach");

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  const db = getDb();
  const { data: lead, error } = await db
    .from("leads")
    .select("id, business_name, email, demo_url, stage")
    .eq("id", params.id)
    .single();

  if (error || !lead) return fail(`lead not found: ${params.id}`, 404);
  if (!lead.demo_url) {
    return fail("Lead has no demo site yet — build the website first.", 400);
  }

  try {
    const providerId = await stage5.run({
      id: lead.id,
      business_name: lead.business_name,
      email: lead.email,
      demo_url: lead.demo_url,
    });

    if (providerId === null) {
      // stage5 already flipped stage='needs_email' for the missing-email case
      return ok({ id: lead.id, status: "needs_email" });
    }
    return ok({ id: lead.id, status: "outreached", provider_id: providerId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ lead_id: lead.id, err: msg }, "outreach.failed");
    await db
      .from("leads")
      .update({ last_error: msg })
      .eq("id", lead.id);
    return fail(`Outreach failed: ${msg}`, 502);
  }
});
