/**
 * sequence-scheduler.ts — Drive the 4-step progressive-trust email sequence.
 *
 * Inputs:  leads with seq_status='active' and seq_next_step_at <= now
 * Outputs: sends the due step, writes outreach_events + email_messages, advances
 *          seq_step / seq_next_step_at (or completes / stops). Never throws per lead.
 * Used by: scripts/cloud-run-job.ts (MODE=sequence), app/api/leads/[id]/sequence/route.ts
 *
 * Cadence: every step 4 days apart (Day 0/4/8/12). Reuses leads + outreach_events
 * (no separate campaign subsystem). Honors the same kill switch, warmup caps and
 * verification gate as stage-5-email. Idempotent: an atomic claim stops two ticks
 * double-sending, and a per-step outreach_event guards against resends.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import { isSuppressed } from "../suppression";
import { sendOutreachEmail, getSenderAccount } from "../services/email-sender";
import { sendDecision } from "../verify/gate";
import { verificationActive } from "../services/email-validator";
import type { VerifyStatus } from "../services/email-validator/types";
import { renderSequenceEmail, type SeqStep } from "../email/sequence-templates";

const log = getLogger("sequence-scheduler");

const DELAY_DAYS = 4; // gap between every step
const CLAIM_MINUTES = 10; // claim window — also auto-retries a crashed mid-send
const HOLD_HOURS = 24; // re-check an unverified lead tomorrow
const DEFAULT_LIMIT = 20;
const MAX_STEP = 4;

interface SeqLeadRow {
  id: string;
  business_name: string;
  email: string | null;
  demo_url: string | null;
  screenshot_url: string | null;
  call_segment: string | null;
  phone: string | null;
  lifecycle_stage: string | null;
  inbox_status: string | null;
  stage: string | null;
  verification_status: string | null;
  seq_status: string | null;
  seq_step: number | null;
  seq_next_step_at: string | null;
  seq_sender_email: string | null;
}

export interface TickSummary {
  due: number;
  sent: number;
  held: number;
  stopped: number;
  completed: number;
  skipped: number;
  paused?: boolean;
}

const SEQ_COLS =
  "id,business_name,email,demo_url,screenshot_url,call_segment,phone,lifecycle_stage," +
  "inbox_status,stage,verification_status,seq_status,seq_step,seq_next_step_at,seq_sender_email";

function plusDaysIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
function plusHoursIso(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/** State patch after a step is sent (or found already sent). */
function advanceState(targetStep: SeqStep): Record<string, unknown> {
  if (targetStep >= MAX_STEP) {
    return { seq_step: MAX_STEP, seq_status: "completed", seq_next_step_at: null };
  }
  return { seq_step: targetStep, seq_next_step_at: plusDaysIso(DELAY_DAYS) };
}

/**
 * Stop a lead's sequence (reply / unsubscribe / suppression / no email).
 * Exported so the reply hooks (email sync + Instantly webhook) can call it.
 */
export async function stopSequence(leadId: string, reason: string): Promise<void> {
  await getDb()
    .from("leads")
    .update({ seq_status: "stopped", seq_next_step_at: null })
    .eq("id", leadId);
  log.info({ lead_id: leadId, reason }, "sequence.stopped");
}

export interface EnrollResult {
  enrolled: boolean;
  reason?: "no_email" | "suppressed" | "no_demo" | "unverified" | "already_active";
}

/**
 * Enroll a lead at step 0 so the next tick sends step 1. Operator-initiated
 * (the dashboard "Enroll" button). Pins the whole ladder to one mailbox.
 */
export async function enrollLeadInSequence(leadId: string): Promise<EnrollResult> {
  const db = getDb();
  const { data: lead } = await db.from("leads").select(SEQ_COLS).eq("id", leadId).single<SeqLeadRow>();
  if (!lead) throw new Error(`lead not found: ${leadId}`);

  if (lead.seq_status === "active") return { enrolled: false, reason: "already_active" };
  if (!lead.email) return { enrolled: false, reason: "no_email" };
  if (!lead.demo_url) return { enrolled: false, reason: "no_demo" };
  if (await isSuppressed(lead, "email")) return { enrolled: false, reason: "suppressed" };
  if (sendDecision((lead.verification_status as VerifyStatus | null), verificationActive()) === "skip") {
    return { enrolled: false, reason: "unverified" };
  }

  const account = await getSenderAccount().catch(() => null);
  await db
    .from("leads")
    .update({
      seq_status: "active",
      seq_step: 0,
      seq_next_step_at: new Date().toISOString(),
      seq_sender_email: account?.email ?? null,
    })
    .eq("id", leadId);
  log.info({ lead_id: leadId, sender: account?.email ?? null }, "sequence.enrolled");
  return { enrolled: true };
}

export async function runSequenceTick(opts?: { limit?: number }): Promise<TickSummary> {
  const summary: TickSummary = { due: 0, sent: 0, held: 0, stopped: 0, completed: 0, skipped: 0 };

  // Global kill switch (deliverability incidents) — same as sendOutreachEmail.
  const pausedUntil = process.env.EMAIL_SENDING_PAUSED_UNTIL;
  if (pausedUntil && Date.parse(pausedUntil) > Date.now()) {
    log.warn({ until: pausedUntil }, "sequence.paused");
    return { ...summary, paused: true };
  }

  const db = getDb();
  const limit = Math.max(1, opts?.limit ?? DEFAULT_LIMIT);
  const { data: due } = await db
    .from("leads")
    .select(SEQ_COLS)
    .eq("seq_status", "active")
    .lte("seq_next_step_at", new Date().toISOString())
    .order("seq_next_step_at", { ascending: true })
    .limit(limit);

  const rows = (due ?? []) as unknown as SeqLeadRow[];
  summary.due = rows.length;

  for (const lead of rows) {
    // Atomic claim — push seq_next_step_at forward; only the tick that flips it
    // off the original timestamp proceeds. Zero rows = another tick won.
    const { data: claimed } = await db
      .from("leads")
      .update({ seq_next_step_at: plusHoursIso(CLAIM_MINUTES / 60) })
      .eq("id", lead.id)
      .eq("seq_status", "active")
      .eq("seq_next_step_at", lead.seq_next_step_at as string)
      .select("id");
    if (!claimed || claimed.length === 0) {
      summary.skipped++;
      continue;
    }

    // Reply / suppression recheck (covers a reply landing between sync and tick).
    const suppressed =
      lead.lifecycle_stage === "unsubscribed" ||
      lead.lifecycle_stage === "dnc" ||
      lead.inbox_status === "needs_reply" ||
      lead.stage === "replied" ||
      (await isSuppressed(lead, "email"));
    if (suppressed) {
      await stopSequence(lead.id, "reply_or_suppressed");
      summary.stopped++;
      continue;
    }

    if (!lead.email) {
      await stopSequence(lead.id, "no_email");
      summary.stopped++;
      continue;
    }

    const targetStep = ((lead.seq_step ?? 0) + 1) as SeqStep;
    if (targetStep > MAX_STEP) {
      await db
        .from("leads")
        .update({ seq_status: "completed", seq_next_step_at: null })
        .eq("id", lead.id);
      summary.completed++;
      continue;
    }

    // Per-step idempotency — already sent this step? Advance without resending.
    const { data: prior } = await db
      .from("outreach_events")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("kind", "email_sent")
      .contains("meta", { step: targetStep })
      .limit(1);
    if (prior && prior.length > 0) {
      await db.from("leads").update(advanceState(targetStep)).eq("id", lead.id);
      summary.skipped++;
      continue;
    }

    // Verification gate (same as stage-5-email).
    const decision = sendDecision((lead.verification_status as VerifyStatus | null), verificationActive());
    if (decision === "skip") {
      await stopSequence(lead.id, "unverified");
      summary.stopped++;
      continue;
    }
    if (decision === "hold") {
      // Re-check tomorrow; stay active.
      await db.from("leads").update({ seq_next_step_at: plusHoursIso(HOLD_HOURS) }).eq("id", lead.id);
      summary.held++;
      continue;
    }

    const rendered = renderSequenceEmail(lead, targetStep);
    const screenshotPath =
      rendered.useScreenshot && lead.screenshot_url ? lead.screenshot_url : undefined;

    const result = await sendOutreachEmail({
      to: lead.email,
      subject: rendered.subject,
      html: rendered.html,
      senderEmail: lead.seq_sender_email,
      screenshotPath,
    });

    // Held by kill switch or daily cap — restore this lead's due time and stop
    // the tick (the next leads would hit the same wall).
    if (result.reason === "paused" || result.reason === "capped") {
      await db
        .from("leads")
        .update({ seq_next_step_at: lead.seq_next_step_at })
        .eq("id", lead.id);
      summary.held++;
      log.info({ lead_id: lead.id, reason: result.reason }, "sequence.deferred");
      break;
    }

    await db.from("outreach_events").insert({
      lead_id: lead.id,
      kind: "email_sent",
      meta: {
        step: targetStep,
        segment: lead.call_segment,
        screenshot: !!screenshotPath,
        link: rendered.useLink,
        noop: result.noop,
        message_id: result.messageId,
      },
    });

    // Record our side of the thread so the Inbox shows it (matches stage-5-email).
    const bodyText = rendered.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    await db.from("email_messages").insert({
      lead_id: lead.id,
      direction: "outbound",
      message_id: result.messageId,
      to_addr: lead.email,
      subject: rendered.subject,
      body_text: bodyText,
      body_snippet: bodyText.slice(0, 200),
      status: result.sent ? "sent" : "failed",
    });

    const patch = advanceState(targetStep);
    // Step 1 also flips the legacy funnel stage so existing reporting works.
    if (targetStep === 1) patch.stage = "outreached";
    await db.from("leads").update(patch).eq("id", lead.id);

    summary.sent++;
    log.info({ lead_id: lead.id, step: targetStep, noop: result.noop }, "sequence.sent");

    // Gentle spacing between sends.
    await new Promise((r) => setTimeout(r, 2_000));
  }

  log.info({ ...summary }, "sequence.tick_done");
  return summary;
}
