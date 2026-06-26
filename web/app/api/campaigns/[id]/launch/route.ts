/**
 * api/campaigns/[id]/launch/route.ts — POST: launch an email campaign by enrolling
 * its members into the screenshot-first sequence engine.
 *
 * Inputs:  params.id (campaign UUID)
 * Outputs: { enrolled, skipped } — how many members were enrolled
 * Used by: operator dashboard "Launch" button (the gated go-live, after a test send)
 *
 * Launch is the explicit go-live step: creating a campaign only drafts it (no
 * sending). Launching enrolls each eligible member into the unified sequence
 * (lib/pipeline/sequence-scheduler), which then sends within warmup caps, the
 * campaign's day/hour window in the prospect's timezone, with cap-aware sender
 * rotation + pinned follow-ups + translation. enrollLeadInSequence is idempotent
 * (already-active members are skipped) and verification-gated, so re-launching is
 * safe and unverified addresses are never enrolled.
 */

import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { enrollableMemberIds } from "@/lib/campaigns/enroll-members";
import { enrollLeadInSequence } from "@/lib/pipeline/sequence-scheduler";
import { staggerSends, type SendWindow } from "@/lib/campaigns/send-window";
import { getLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("campaigns.launch");

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const db = getDb();

  const { data: camp } = await db
    .from("call_campaigns")
    .select("id,channel,status,call_days,call_start_hour,call_end_hour,timezone")
    .eq("id", params.id)
    .maybeSingle();
  if (!camp) return fail("Campaign not found", 404);
  if (camp.channel !== "email") {
    return fail("Only email campaigns launch here; SMS/DM are worked from the queue.", 400);
  }

  // Members + the fields the enroll gate needs.
  const { data: rawMembers } = await db
    .from("campaign_leads")
    .select("lead_id, leads(id,email,seq_status)")
    .eq("campaign_id", camp.id);

  const members = (rawMembers ?? []) as unknown as {
    lead_id: string;
    leads: { id: string; email: string | null; seq_status: string | null } | null;
  }[];
  const leadRows = members
    .map((m) => m.leads)
    .filter((l): l is { id: string; email: string | null; seq_status: string | null } => !!l);

  const toEnroll = enrollableMemberIds(leadRows);

  // Stagger the FIRST send across the campaign's send window so the batch drips
  // out instead of all going "due now" at once (a burst is a deliverability red
  // flag). gap = window minutes / batch size, clamped so it's neither a flood
  // nor absurdly sparse; nextSlot rolls overflow to the next allowed day, and
  // per-mailbox daily caps still throttle volume on top.
  const window: SendWindow = {
    tz: camp.timezone ?? "America/New_York",
    days: camp.call_days ?? [1, 2, 3, 4, 5],
    startHour: camp.call_start_hour ?? 9,
    endHour: camp.call_end_hour ?? 20,
  };
  const windowMinutes = Math.max(60, (window.endHour - window.startHour) * 60);
  const gapMinutes = Math.min(45, Math.max(3, Math.round(windowMinutes / Math.max(1, toEnroll.length))));
  const schedule = staggerSends({ ids: toEnroll, window, after: new Date(), gapMinutes });

  let enrolled = 0;
  const reasons: Record<string, number> = {};
  for (const id of toEnroll) {
    try {
      const res = await enrollLeadInSequence(id, schedule[id]);
      if (res.enrolled) enrolled += 1;
      else reasons[res.reason ?? "skipped"] = (reasons[res.reason ?? "skipped"] ?? 0) + 1;
    } catch (err) {
      log.warn({ leadId: id, err: String(err) }, "launch.enroll_failed");
      reasons.error = (reasons.error ?? 0) + 1;
    }
  }

  // Mark the campaign active once at least one member is enrolled (sending).
  if (enrolled > 0 && camp.status !== "active") {
    await db.from("call_campaigns").update({ status: "active" }).eq("id", camp.id);
  }

  const skipped = toEnroll.length - enrolled;
  return ok({ enrolled, skipped, reasons });
});
