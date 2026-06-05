/**
 * api/campaigns/[id]/launch/route.ts — POST: send pending email campaign members within the daily cap.
 *
 * Inputs:  params.id (campaign UUID)
 * Outputs: { sent, held, skipped } — counts for this batch run
 * Used by: operator dashboard "Launch" button on email campaigns
 *
 * Reuses stage-5-email's run() which internally enforces the kill-switch + warmup-ramped
 * daily cap + idempotency + suppression. When a send returns skipped='paused'|'capped',
 * the loop stops (cap or kill-switch hit) and remaining members stay pending for the next run.
 * Voice/DM campaigns are worked from the campaign detail queue, not here.
 * SMS: stage-6-sms has no cap/kill-switch guard, so SMS launch is deferred to the queue
 * (returns 400 until that guard is added).
 */

import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { run as runEmail, type EmailLead } from "@/lib/pipeline/stage-5-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max members to attempt per call — cap/kill-switch will stop us earlier. */
const BATCH = 100;

type MemberRow = {
  lead_id: string;
  status: string;
  leads: EmailLead | null;
};

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const db = getDb();
  const body = (await req.json().catch(() => ({}))) as { senderEmail?: string };
  const senderEmail =
    typeof body.senderEmail === "string" && body.senderEmail.trim() ? body.senderEmail.trim() : undefined;

  const { data: camp } = await db
    .from("call_campaigns")
    .select("id,channel,status")
    .eq("id", params.id)
    .maybeSingle();
  if (!camp) return fail("Campaign not found", 404);

  if (camp.channel === "sms") {
    return fail(
      "SMS launch not wired yet — stage-6-sms has no cap/kill-switch guard. Work SMS from the campaign queue.",
      400,
    );
  }
  if (camp.channel !== "email") {
    return fail(
      "Only email campaigns can be launched here; voice/DM campaigns are worked from the queue.",
      400,
    );
  }

  // Pull pending members with the lead fields the email sender needs.
  const { data: rawMembers } = await db
    .from("campaign_leads")
    .select(
      "lead_id,status,leads(id,business_name,email,phone,primary_offer,lifecycle_stage,demo_url,verification_status)",
    )
    .eq("campaign_id", camp.id)
    .eq("status", "pending")
    .limit(BATCH);

  const members = (rawMembers ?? []) as unknown as MemberRow[];

  let sent = 0;
  let held = 0;
  let skipped = 0;

  for (const m of members) {
    const lead = m.leads;
    if (!lead) {
      skipped += 1;
      continue;
    }

    const res = await runEmail(lead as EmailLead, { senderEmail });

    // Cap or kill-switch hit — stop this batch; remaining members stay pending.
    if (res.skipped === "paused" || res.skipped === "capped") {
      held += 1;
      break;
    }

    if (res.sent) {
      sent += 1;
      const { error: upErr } = await db
        .from("campaign_leads")
        .update({ status: "sent" })
        .eq("campaign_id", camp.id)
        .eq("lead_id", m.lead_id);
      if (upErr) console.warn("[launch] failed to mark member sent", m.lead_id, upErr.message);
    } else {
      skipped += 1;
    }
  }

  // Mark campaign active once we've successfully launched at least one batch.
  if (camp.status !== "active") {
    await db.from("call_campaigns").update({ status: "active" }).eq("id", camp.id);
  }

  return ok({ sent, held, skipped });
});
