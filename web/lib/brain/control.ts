/**
 * brain/control.ts — Pause, Resume, Cancel a Brain job, or raise its budget.
 *
 * Inputs:  job id + the action; brain_jobs, brain_job_leads, the job's email campaign, the Quick calls queue
 * Outputs: the job's new status; its emails paused / resumed / stopped (lib/campaigns/campaign-status.ts); on Cancel
 *          its open leads closed ("Job cancelled") and their not-yet-dialled calls removed
 * Used by: app/api/brain/jobs/[id]/control/route.ts
 *
 * Pause holds everything (emails, forms, new calls); Resume continues, but not while the budget is used up. Cancel is
 * for a job being set up, in review, running or paused: what was already sent stays in each lead's history. A search
 * or a planning in progress can't be cancelled here (cancel the batch on its page; the job then fails by itself).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { setCampaignStatus, type CampaignStatus } from "@/lib/campaigns/campaign-status";
import { getJob, updateJob, type BrainJob } from "./jobs";
import { FORM_USD, canSpend, cleanSettings, type JobStatus } from "./rules";

const log = getLogger("brain-control");

export type ControlAction = { kind: "pause" } | { kind: "resume" } | { kind: "cancel" } | { kind: "raise_budget"; budgetUsd: number };

export interface ControlDeps {
  getJob: (id: string) => Promise<BrainJob | null>;
  updateJob: (id: string, patch: Partial<BrainJob>, onlyIfStatus?: JobStatus[]) => Promise<boolean>;
  setEmails: (campaignId: string, status: CampaignStatus) => Promise<void>;
  /** Close the job's approved rows that have no outcome yet; returns their lead ids. */
  closeOpenRows: (jobId: string, reason: string) => Promise<string[]>;
  /** Remove the lead's call from the queue when it hasn't been dialled yet. */
  dropCall: (leadId: string) => Promise<void>;
}

/** What to do with a lead's place in the call queue when its job no longer wants the call. Pure. */
export function callMemberAction(m: { status: string; call_attempts: number | null }): "delete" | "skip" | "keep" {
  if (m.status !== "pending" && m.status !== "called") return "keep"; // answered / done / already skipped: its record stays
  // Never dialled → no trace needed. Already tried (waiting for a retry) → skipped, so the call worker never retries it.
  return m.status === "pending" && !m.call_attempts ? "delete" : "skip";
}

/**
 * Take a lead out of the "Quick calls (AI)" queue: a call never dialled is removed, one waiting for a retry is
 * skipped (the call worker only dials pending / called members), anything already answered keeps its record.
 */
export async function dropQueuedCall(leadId: string): Promise<void> {
  const db = getDb();
  const { data } = await db.from("call_campaigns").select("id").eq("channel", "call").like("name", "Quick calls (AI)%");
  const ids = ((data ?? []) as { id: string }[]).map((x) => x.id);
  if (!ids.length) return;
  const { data: members, error } = await db.from("campaign_leads").select("campaign_id,status,call_attempts").eq("lead_id", leadId).in("campaign_id", ids);
  if (error) return void log.warn({ lead_id: leadId, err: error.message }, "brain.drop_call_failed");
  for (const m of (members ?? []) as { campaign_id: string; status: string; call_attempts: number | null }[]) {
    const action = callMemberAction(m);
    if (action === "keep") continue;
    const key = { campaign_id: m.campaign_id, lead_id: leadId };
    const q = action === "delete" ? db.from("campaign_leads").delete().match(key).eq("status", "pending") : db.from("campaign_leads").update({ status: "skipped", next_call_at: null }).match(key).in("status", ["pending", "called"]);
    const { error: e } = await q;
    if (e) log.warn({ lead_id: leadId, err: e.message }, "brain.drop_call_failed");
  }
}

const defaultDeps: ControlDeps = {
  getJob,
  updateJob,
  setEmails: async (campaignId, status) => {
    await setCampaignStatus(campaignId, status);
  },
  closeOpenRows: async (jobId, reason) => {
    const { data, error } = await getDb()
      .from("brain_job_leads")
      .update({ outcome: "stopped", outcome_reason: reason, updated_at: new Date().toISOString() })
      .eq("job_id", jobId)
      .eq("approved", true)
      .is("outcome", null)
      .select("lead_id");
    if (error) throw new Error(error.message);
    return ((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id);
  },
  dropCall: dropQueuedCall,
};

const CANCELLABLE: JobStatus[] = ["asking", "review", "running", "paused"];

export async function controlJob(jobId: string, action: ControlAction, deps: ControlDeps = defaultDeps): Promise<{ ok: true; job: BrainJob } | { ok: false; message: string }> {
  const job = await deps.getJob(jobId);
  if (!job) return { ok: false, message: "Job not found." };
  const done = (patch: Partial<BrainJob>) => ({ ok: true as const, job: { ...job, ...patch } });

  if (action.kind === "pause") {
    const patch = { status: "paused" as const, notice: "Paused by you." };
    if (!(await deps.updateJob(jobId, patch, ["running"]))) return { ok: false, message: "Only a running job can be paused." };
    if (job.email_campaign_id) await deps.setEmails(job.email_campaign_id, "paused");
    return done(patch);
  }

  if (action.kind === "resume") {
    if (job.status !== "paused") return { ok: false, message: "Only a paused job can be resumed." };
    if (!canSpend(job.spent_usd, FORM_USD, job.settings.budgetUsd)) {
      return { ok: false, message: `The budget is used up ($${job.spent_usd.toFixed(2)} of $${job.settings.budgetUsd.toFixed(2)}). Raise the budget first.` };
    }
    const patch = { status: "running" as const, notice: null };
    if (!(await deps.updateJob(jobId, patch, ["paused"]))) return { ok: false, message: "Only a paused job can be resumed." };
    if (job.email_campaign_id) await deps.setEmails(job.email_campaign_id, "active");
    return done(patch);
  }

  if (action.kind === "raise_budget") {
    if (job.status === "done" || job.status === "cancelled" || job.status === "failed") return { ok: false, message: "This job is finished." };
    const budgetUsd = cleanSettings({ ...job.settings, budgetUsd: action.budgetUsd }).budgetUsd;
    if (budgetUsd <= job.spent_usd) return { ok: false, message: `The budget must be above what was already spent ($${job.spent_usd.toFixed(2)}).` };
    const patch = { settings: { ...job.settings, budgetUsd }, ...(job.notice?.startsWith("Budget reached") ? { notice: null } : {}) };
    await deps.updateJob(jobId, patch);
    return done(patch);
  }

  // cancel
  // A list job cancelled before Start: its rows (other businesses' details) are cleared too. Only a list job names
  // that column, so cancelling still works where migration 081 isn't applied (review I1).
  const patch = {
    status: "cancelled" as const,
    notice: "Cancelled by you. What was already sent stays in each lead's history.",
    ...(job.intent === "work_list" ? { import_rows: null } : {}),
  };
  if (!(await deps.updateJob(jobId, patch, CANCELLABLE))) {
    return {
      ok: false,
      message:
        job.status === "searching" || job.status === "planning"
          ? "It is still searching or judging. Cancel the batch on its page, or wait for the plan and cancel then."
          : "This job is already finished.",
    };
  }
  if (job.email_campaign_id) await deps.setEmails(job.email_campaign_id, "done");
  const closed = await deps.closeOpenRows(jobId, "Job cancelled");
  for (const leadId of closed) await deps.dropCall(leadId);
  log.info({ job_id: jobId, was: job.status, closed: closed.length }, "brain.job_cancelled");
  return done(patch);
}
