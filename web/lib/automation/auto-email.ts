/**
 * automation/auto-email.ts — start a batch's email by itself 24 h after the batch finishes (24 Nov 2026).
 *
 * Inputs:  a batch id (arm / cancel); the time (start the due ones)
 * Outputs: batches.auto_email_at / auto_email_state / auto_email_note / auto_email_campaign_id (migration 068);
 *          a batch email campaign via lib/campaigns/batch-email-plan.ts startBatchEmail
 * Used by: lib/pipeline/orchestrator.ts (arm, when a batch finishes), lib/automation/tick.ts (start the due ones),
 *          app/api/batches/[id]/auto-email/route.ts (cancel)
 *
 * Only batches whose settings.auto_email is on (the New batch form's "Email this batch automatically", always for
 * scheduled batches). Starting uses the batch email defaults: 10 a day, follow-ups off, EU / UK out, Send email's
 * ready-made email per offer, contact forms on. Missing columns (068 not applied) = nothing happens, logged.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { BatchEmailError, DEFAULT_DAILY_LIMIT, startBatchEmail } from "@/lib/campaigns/batch-email-plan";
import { autoEmailDue, autoEmailStartAt } from "./rules";

const log = getLogger("auto-email");

/** A batch just finished: if it asked for it, its email starts 24 h from now. Never throws. */
export async function armAutoEmail(batchId: string, finishedAt: Date = new Date()): Promise<void> {
  try {
    const db = getDb();
    const { data } = await db.from("batches").select("settings").eq("id", batchId).maybeSingle();
    const settings = (data as { settings?: { auto_email?: boolean } | null } | null)?.settings;
    if (!settings?.auto_email) return;
    const { error } = await db
      .from("batches")
      .update({ auto_email_state: "waiting", auto_email_at: autoEmailStartAt(finishedAt), auto_email_note: null })
      .eq("id", batchId)
      .is("auto_email_state", null);
    if (error) log.warn({ batch_id: batchId, err: error.message }, "auto_email.arm_failed (migration 068 applied?)");
    else log.info({ batch_id: batchId }, "auto_email.armed");
  } catch (err) {
    log.warn({ batch_id: batchId, err: String(err) }, "auto_email.arm_failed");
  }
}

/** Cancel before it starts. False when it wasn't waiting (already started, skipped or cancelled). */
export async function cancelAutoEmail(batchId: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from("batches")
    .update({ auto_email_state: "cancelled", auto_email_note: "Cancelled by hand." })
    .eq("id", batchId)
    .eq("auto_email_state", "waiting")
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Start every batch email whose time has come. Each batch is claimed first, so two runs never start it twice. */
export async function startDueAutoEmails(now: number = Date.now()): Promise<{ started: number; skipped: number }> {
  const db = getDb();
  const { data, error } = await db
    .from("batches")
    .select("id,status,auto_email_state,auto_email_at")
    .eq("auto_email_state", "waiting")
    .lte("auto_email_at", new Date(now).toISOString())
    .limit(5);
  if (error) {
    log.warn({ err: error.message }, "auto_email.read_failed (migration 068 applied?)");
    return { started: 0, skipped: 0 };
  }
  let started = 0;
  let skipped = 0;
  for (const b of (data ?? []) as { id: string; status: string | null; auto_email_state: string | null; auto_email_at: string | null }[]) {
    if (!autoEmailDue(b, now)) continue;
    // Only a finished batch: one being re-run waits an hour; a failed / paused / cancelled one doesn't start.
    if (b.status === "running" || b.status === "queued") {
      await db.from("batches").update({ auto_email_at: new Date(now + 3_600_000).toISOString() }).eq("id", b.id).eq("auto_email_state", "waiting");
      continue;
    }
    if (b.status !== "done") {
      await db.from("batches").update({ auto_email_state: "skipped", auto_email_note: `The batch didn't finish (${b.status ?? "unknown"}).` }).eq("id", b.id).eq("auto_email_state", "waiting");
      skipped++;
      continue;
    }
    const { data: claimed } = await db.from("batches").update({ auto_email_state: "started" }).eq("id", b.id).eq("auto_email_state", "waiting").select("id");
    if (!claimed?.length) continue;
    try {
      const r = await startBatchEmail(b.id, { includeEu: false, choices: {}, dailyLimit: DEFAULT_DAILY_LIMIT, followUps: 0, contactForms: true });
      await db.from("batches").update({ auto_email_campaign_id: r.campaignId, auto_email_note: `Started: ${r.enrolled} leads, ${DEFAULT_DAILY_LIMIT} a day.` }).eq("id", b.id);
      started++;
      log.info({ batch_id: b.id, campaign_id: r.campaignId, enrolled: r.enrolled }, "auto_email.started");
    } catch (err) {
      const note = err instanceof BatchEmailError ? err.message : `Couldn't start: ${String(err).slice(0, 200)}`;
      await db.from("batches").update({ auto_email_state: "skipped", auto_email_note: note }).eq("id", b.id);
      skipped++;
      log.warn({ batch_id: b.id, note }, "auto_email.skipped");
    }
  }
  return { started, skipped };
}
