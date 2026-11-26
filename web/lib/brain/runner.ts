/**
 * brain/runner.ts — moves the running Brain jobs forward: stops and wins, due contact forms, due calls, done.
 *
 * Inputs:  the time; brain_jobs (running, plus searching / planning ones to repair), their approved rows, each lead
 *          as it is now; the kill switch; the batch's sending window
 * Outputs: contact forms through the normal look → send steps (contact_form_runs.source 'brain'); calls queued in the
 *          standing "Quick calls (AI)" campaign with the offer's Voizo script; brain_job_leads progress; the job's
 *          spend; jobs paused at their budget or marked done; a summary for the tick's log
 * Used by: lib/automation/tick.ts (Cloud Run MODE=automation, every 15 minutes: it has the browser the forms need)
 *
 * Order per job: (1) re-read every open lead: a reply / interested call = win, unsubscribe / not interested = stop;
 * both close the lead's other steps. (2) contact forms that are due: working hours, the job's forms-per-day, 2 per run
 * in all, never past the budget (the job pauses instead). (3) calls that are due: the job's calls-per-day. (4) leads
 * with nothing left are done; a job with no open lead is done. Each form and call is claimed with a conditional
 * update first, so two overlapping runs can't do it twice. Emails are not sent here (the sequence tick does).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { isWithinWindow } from "@/lib/campaigns/send-window";
import { emailFor, makeEmailPicker, poolFor, type BatchLead, type SavedTpl } from "@/lib/campaigns/batch-email";
import { setCampaignStatus } from "@/lib/campaigns/campaign-status";
import { listTemplates } from "@/lib/email/template-library";
import { listTests, winnersByOffer } from "@/lib/email/email-tests";
import type { ServiceKey } from "@/lib/email/service-templates";
import { latestRun, runLookStep, runSendStep, startLook, startSend } from "@/lib/contact-form/runs";
import { queueQuickCall } from "@/lib/calls/quick-call";
import { isVoizoConfigured, listScripts } from "@/lib/services/voizo";
import { stopSequence } from "@/lib/pipeline/sequence-scheduler";
import { batchWindow } from "./approve";
import { dropQueuedCall } from "./control";
import { callDue, formDue, rowFinished, stopReason, type JobLeadRow, type LeadNow } from "./due";
import { addSpend, getJob, jobsWithStatus, updateJob, type BrainJob } from "./jobs";
import { buildPlan } from "./plan";
import { FORM_USD, canSpend, type JobStatus } from "./rules";

const log = getLogger("brain-runner");

/** Contact forms per run of the tick, over all jobs (each takes a minute or two). */
export const FORMS_PER_TICK = 2;
/** A planning step that hasn't moved for this long died: it is run again. */
const PLANNING_STALE_MS = 30 * 60_000;
/** An approval that hasn't finished after this long died (the request was cut off): it is undone. */
const APPROVE_STALE_MS = 10 * 60_000;
/** A contact form send that hasn't reported back for this long died. It may have gone out: never sent again. */
const FORM_STALE_MS = 30 * 60_000;

export interface RunnerDeps {
  now: () => number;
  killSwitch: () => boolean;
  jobs: (statuses: JobStatus[]) => Promise<BrainJob[]>;
  updateJob: (id: string, patch: Partial<BrainJob>, onlyIfStatus?: JobStatus[]) => Promise<boolean>;
  /** Returns the job's new total. */
  addSpend: (id: string, usd: number) => Promise<number>;
  batchStatus: (batchId: string) => Promise<string | null>;
  plan: (jobId: string) => Promise<unknown>;
  /** The job's approved rows that have no outcome yet. */
  rows: (jobId: string) => Promise<JobLeadRow[]>;
  leadsNow: (ids: string[]) => Promise<Map<string, LeadNow>>;
  /** With `onlyIf`, one conditional update (the claim): false when the row was no longer in that state. */
  setRow: (jobId: string, leadId: string, patch: Record<string, unknown>, onlyIf?: { form_state?: string; call_state?: string }) => Promise<boolean>;
  stopEmails: (leadId: string, reason: string) => Promise<void>;
  /** Remove the lead's call from the queue when it hasn't been dialled yet. */
  dropCall: (leadId: string) => Promise<void>;
  pauseEmails: (campaignId: string) => Promise<void>;
  inWindow: (batchId: string, now: number) => Promise<boolean>;
  formsToday: (jobId: string) => Promise<number>;
  callsToday: (jobId: string) => Promise<number>;
  sendForm: (job: BrainJob, row: JobLeadRow) => Promise<{ state: "sent" | "needs_person" | "failed"; usd: number; note: string | null }>;
  queueCall: (leadId: string, offer: string) => Promise<{ queued: boolean; message: string }>;
  /** Is the job still running right now? Asked before each form and call (Cancel / Pause may have come meanwhile). */
  stillRunning: (jobId: string) => Promise<boolean>;
  /** Undo an approval that died half-way: stop the emails it may have set up for this job's batch. */
  abortApproval: (job: BrainJob) => Promise<void>;
}

export interface RunSummary {
  jobs: number;
  forms: number;
  calls: number;
  wins: number;
  done: number;
  notes: string[];
}

/* ---------------------------------------------------------------- real deps ------------------------------------ */

const FORM_LEAD_COLS =
  "id,business_name,email,verification_status,qualified,lifecycle_stage,stage,seq_status,country_code,call_segment," +
  "website_kind,has_website,needs_improvement,signal_type,signal_meta,contact_owner_name,category,demo_url";

/** One lead's contact form through the normal steps: look at it, and when it can be filled, send the offer's email once. */
async function sendFormForRow(job: BrainJob, row: JobLeadRow): Promise<{ state: "sent" | "needs_person" | "failed"; usd: number; note: string | null }> {
  const db = getDb();
  const offer = row.offer as ServiceKey | null;
  if (!offer) return { state: "failed", usd: 0, note: "No offer on this row." };
  const start = await startLook(row.lead_id, { force: true, source: "brain" });
  if (!start.ok) return { state: "failed", usd: 0, note: start.message };
  await runLookStep(start.run.id);
  const looked = await latestRun(row.lead_id);
  if (!looked || looked === "no_table" || looked.id !== start.run.id) return { state: "failed", usd: 0, note: "The look at their form didn't finish." };
  if (looked.status !== "ready") {
    const person = looked.status === "blocked" || looked.status === "no_form";
    return { state: person ? "needs_person" : "failed", usd: looked.usd ?? 0, note: looked.text };
  }
  const [{ data: lead }, { data: batch }, { templates }, finished, { data: boxData }] = await Promise.all([
    db.from("leads").select(FORM_LEAD_COLS).eq("id", row.lead_id).maybeSingle(),
    job.batch_id ? db.from("batches").select("city").eq("id", job.batch_id).maybeSingle() : Promise.resolve({ data: null }),
    listTemplates(),
    listTests().then((r) => r.tests).catch(() => []),
    db.from("email_accounts").select("email,from_name").eq("status", "active"),
  ]);
  const boxes = (boxData ?? []) as { email: string; from_name: string | null }[];
  if (!lead || !boxes.length) return { state: "failed", usd: 0, note: lead ? "No sending mailbox is connected." : "Lead not found." };
  const saved: SavedTpl[] = templates.map((t) => ({ ...t, version: (t as { version?: number }).version ?? 1 }));
  // No wording-test turns for forms (they are not emails): the offer's starting email.
  const picked = makeEmailPicker({ tests: [], winners: winnersByOffer(finished) }).pick(offer, "auto");
  const pool = poolFor(offer, boxes);
  const box = pool[Math.abs(row.lead_id.charCodeAt(0) + row.lead_id.charCodeAt(1)) % pool.length];
  const email = emailFor(picked.key, offer, lead as unknown as BatchLead, { city: (batch as { city: string | null } | null)?.city ?? null, senderName: box.from_name }, saved);
  const s = await startSend(row.lead_id, { runId: looked.id, senderEmail: box.email, subject: email.subject, message: email.body, offerKey: offer });
  if (!s.ok) return { state: "failed", usd: 0, note: s.message };
  await runSendStep(looked.id);
  const sent = await latestRun(row.lead_id);
  if (!sent || sent === "no_table") return { state: "failed", usd: 0, note: "The send didn't report back. Check their page." };
  const state = sent.status === "sent" ? "sent" : sent.status === "blocked" || sent.status === "no_form" ? "needs_person" : "failed";
  return { state, usd: sent.usd ?? 0, note: state === "sent" ? null : sent.text };
}

async function scriptForOffer(offer: string): Promise<string | null> {
  if (!isVoizoConfigured()) return null;
  const r = await listScripts().catch(() => null);
  if (!r?.ok) return null;
  return r.data.scripts.find((s) => s.offerKey === offer && s.canDial !== false)?.campaignId ?? null;
}

const defaultDeps: RunnerDeps = {
  now: () => Date.now(),
  killSwitch: () => {
    const until = process.env.EMAIL_SENDING_PAUSED_UNTIL;
    return Boolean(until && Date.parse(until) > Date.now());
  },
  jobs: jobsWithStatus,
  updateJob,
  addSpend,
  batchStatus: async (batchId) => {
    const { data } = await getDb().from("batches").select("status").eq("id", batchId).maybeSingle();
    return (data as { status: string } | null)?.status ?? null;
  },
  plan: buildPlan,
  rows: async (jobId) => {
    const { data, error } = await getDb()
      .from("brain_job_leads")
      .select("job_id,lead_id,decision,offer,channels,approved,first_touch_at,form_state,call_due_at,call_state,outcome,updated_at")
      .eq("job_id", jobId)
      .eq("approved", true)
      .is("outcome", null)
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as JobLeadRow[];
  },
  leadsNow: async (ids) => {
    const out = new Map<string, LeadNow>();
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await getDb().from("leads").select("id,stage,lifecycle_stage,call_status,seq_status").in("id", ids.slice(i, i + 150));
      // A failed read must never look like "nothing to stop": stop this job's run instead.
      if (error) throw new Error(`can't read leads: ${error.message}`);
      for (const l of (data ?? []) as (LeadNow & { id: string })[]) out.set(l.id, l);
    }
    return out;
  },
  setRow: async (jobId, leadId, patch, onlyIf) => {
    let q = getDb().from("brain_job_leads").update({ ...patch, updated_at: new Date().toISOString() }).eq("job_id", jobId).eq("lead_id", leadId);
    if (onlyIf?.form_state) q = q.eq("form_state", onlyIf.form_state);
    if (onlyIf?.call_state) q = q.eq("call_state", onlyIf.call_state);
    // A claim never takes a lead that was closed meanwhile (won, stopped, job cancelled).
    if (onlyIf) q = q.is("outcome", null);
    const { data, error } = await q.select("lead_id");
    if (error) throw new Error(error.message);
    return ((data as unknown[] | null) ?? []).length === 1;
  },
  stopEmails: stopSequence,
  dropCall: dropQueuedCall,
  pauseEmails: async (campaignId) => {
    await setCampaignStatus(campaignId, "paused");
  },
  inWindow: async (batchId, now) => isWithinWindow(new Date(now), await batchWindow(batchId)),
  formsToday: async (jobId) => {
    // Counted on the job's own rows (a little high after a late update, never low: the safe side).
    const { count, error } = await getDb()
      .from("brain_job_leads")
      .select("lead_id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .in("form_state", ["sending", "sent", "needs_person", "failed"])
      .gte("updated_at", new Date(Date.now() - 86_400_000).toISOString());
    if (error) throw new Error(error.message);
    return count ?? 0;
  },
  callsToday: async (jobId) => {
    const { count, error } = await getDb()
      .from("brain_job_leads")
      .select("lead_id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("call_state", "queued")
      .gte("call_due_at", new Date(Date.now() - 86_400_000).toISOString());
    if (error) throw new Error(error.message);
    return count ?? 0;
  },
  sendForm: sendFormForRow,
  stillRunning: async (jobId) => (await getJob(jobId))?.status === "running",
  abortApproval: async (job) => {
    const db = getDb();
    const ids = new Set<string>(job.email_campaign_id ? [job.email_campaign_id] : []);
    if (job.batch_id) {
      const { data } = await db.from("call_campaigns").select("id").eq("batch_id", job.batch_id).eq("channel", "email").like("name", "Brain ·%").in("status", ["building", "active", "paused"]);
      for (const c of (data ?? []) as { id: string }[]) ids.add(c.id);
      // A campaign still "building" has no members yet: stop its leads by the campaign id written in their plan.
      const { data: leads } = await db.from("leads").select("id,seq_copy_overrides").eq("batch_id", job.batch_id).eq("seq_status", "active").limit(2000);
      const mine = ((leads ?? []) as { id: string; seq_copy_overrides: Record<string, { campaign_id?: string }> | null }[])
        .filter((l) => ids.has(l.seq_copy_overrides?.["1"]?.campaign_id ?? ""))
        .map((l) => l.id);
      for (let i = 0; i < mine.length; i += 200) {
        await db.from("leads").update({ seq_status: "stopped", seq_next_step_at: null }).in("id", mine.slice(i, i + 200)).eq("seq_status", "active");
      }
    }
    for (const id of ids) await setCampaignStatus(id, "done");
  },
  queueCall: async (leadId, offer) => {
    const voizoCampaignId = await scriptForOffer(offer);
    if (!voizoCampaignId) return { queued: false, message: "No AI call script for this offer right now." };
    const r = await queueQuickCall(leadId, { voizoCampaignId });
    return { queued: r.queued, message: r.message };
  },
};

/* ---------------------------------------------------------------- the run -------------------------------------- */

const money = (n: number) => `$${n.toFixed(2)}`;

async function runJob(job: BrainJob, now: number, deps: RunnerDeps, state: { formsLeft: number }, out: RunSummary): Promise<void> {
  const rows = await deps.rows(job.id);
  const leads = await deps.leadsNow(rows.map((r) => r.lead_id));

  // 1. Stops and wins first: nothing below runs for a lead that answered or asked us to stop.
  const open: JobLeadRow[] = [];
  for (const row of rows) {
    const lead = leads.get(row.lead_id);
    const stop = lead ? stopReason(lead) : { kind: "stopped" as const, reason: "The lead was removed" };
    if (!stop) {
      open.push(row);
      continue;
    }
    await deps.setRow(job.id, row.lead_id, {
      outcome: stop.kind,
      outcome_reason: stop.reason,
      ...(row.form_state === "pending" ? { form_state: "skipped" } : {}),
      ...(row.call_state === "pending" ? { call_state: "skipped" } : {}),
    });
    await deps.stopEmails(row.lead_id, `brain job: ${stop.reason}`);
    await deps.dropCall(row.lead_id);
    if (stop.kind === "win") out.wins++;
  }

  // A form send that died mid-way (the run was killed): close it as failed with "check their page". It may have gone
  // out, so it is never sent again; closing it lets the lead (and the job) finish.
  for (const row of open) {
    if (row.form_state !== "sending" || !row.updated_at || now - Date.parse(row.updated_at) < FORM_STALE_MS) continue;
    const closed = await deps.setRow(
      job.id,
      row.lead_id,
      { form_state: "failed", outcome_reason: "The contact form send didn't report back. Check their page before sending it yourself." },
      { form_state: "sending" },
    );
    if (closed) row.form_state = "failed";
  }

  // 2. Contact forms that are due.
  if (job.settings.channels.form && !deps.killSwitch() && state.formsLeft > 0 && job.batch_id) {
    const due = open.filter((r) => formDue(r, now));
    if (due.length && (await deps.inWindow(job.batch_id, now))) {
      let today = await deps.formsToday(job.id);
      let spent = job.spent_usd;
      for (const row of due) {
        if (state.formsLeft <= 0 || today >= job.settings.perDay.forms) break;
        if (!canSpend(spent, FORM_USD, job.settings.budgetUsd)) {
          // Never past the budget: the job pauses (emails too) until the operator raises it.
          const notice = `Budget reached (${money(spent)} of ${money(job.settings.budgetUsd)}). Raise the budget to continue.`;
          if (await deps.updateJob(job.id, { status: "paused", notice }, ["running"])) {
            if (job.email_campaign_id) await deps.pauseEmails(job.email_campaign_id);
            out.notes.push(`${job.id}: paused, budget reached`);
          }
          return;
        }
        if (!(await deps.stillRunning(job.id))) return; // cancelled or paused since this run read the job
        // The claim: only one run takes this lead's form.
        if (!(await deps.setRow(job.id, row.lead_id, { form_state: "sending" }, { form_state: "pending" }))) continue;
        state.formsLeft--;
        today++;
        const res = await deps.sendForm(job, row).catch((e) => ({ state: "failed" as const, usd: 0, note: `Something went wrong: ${String(e).slice(0, 160)}` }));
        await deps.setRow(job.id, row.lead_id, { form_state: res.state, ...(res.note ? { outcome_reason: res.note.slice(0, 300) } : {}) });
        if (res.usd > 0) spent = await deps.addSpend(job.id, res.usd);
        row.form_state = res.state;
        if (res.state === "sent") out.forms++;
        log.info({ job_id: job.id, lead_id: row.lead_id, state: res.state, usd: res.usd }, "brain.form_done");
      }
    }
  }

  // 3. Calls that are due (a call only ever for a row whose ☎ stayed ticked: callDue checks the channel).
  if (job.settings.channels.call) {
    const due = open.filter((r) => callDue(r, now));
    if (due.length) {
      let today = await deps.callsToday(job.id);
      const at = new Date(now).toISOString();
      for (const row of due) {
        if (today >= job.settings.perDay.calls) break;
        if (!row.offer) continue;
        if (!(await deps.stillRunning(job.id))) return; // cancelled or paused since this run read the job
        // The claim; call_due_at now holds when it was queued (counted per day, and when the call "settles").
        if (!(await deps.setRow(job.id, row.lead_id, { call_state: "queued", call_due_at: at }, { call_state: "pending" }))) continue;
        today++;
        const q = await deps.queueCall(row.lead_id, row.offer).catch((e) => ({ queued: false, message: `Couldn't queue the call: ${String(e).slice(0, 160)}` }));
        if (q.queued) {
          row.call_state = "queued";
          row.call_due_at = at;
          out.calls++;
        } else {
          row.call_state = "skipped";
          await deps.setRow(job.id, row.lead_id, { call_state: "skipped", outcome_reason: q.message.slice(0, 300) });
        }
      }
    }
  }

  // 4. Leads with nothing left are done; a job with no open lead is done.
  let remaining = 0;
  for (const row of open) {
    const lead = leads.get(row.lead_id)!;
    if (rowFinished(row, lead, now)) await deps.setRow(job.id, row.lead_id, { outcome: "done" });
    else remaining++;
  }
  if (!remaining && (await deps.updateJob(job.id, { status: "done", notice: null }, ["running"]))) {
    out.done++;
    log.info({ job_id: job.id }, "brain.job_done");
  }
}

export async function runBrainJobs(now: number = Date.now(), deps: RunnerDeps = defaultDeps): Promise<RunSummary> {
  const out: RunSummary = { jobs: 0, forms: 0, calls: 0, wins: 0, done: 0, notes: [] };
  const guard = async (id: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      out.notes.push(`${id}: ${String(err).slice(0, 200)}`);
      log.error({ job_id: id, err: String(err) }, "brain.job_run_failed");
    }
  };

  // Repairs: the hook at the end of a search can be missed when that run dies.
  for (const job of await deps.jobs(["searching"])) {
    await guard(job.id, async () => {
      const status = job.batch_id ? await deps.batchStatus(job.batch_id) : null;
      if (status === "done") await deps.plan(job.id);
      else if (status === null || status === "failed" || status === "cancelled") {
        await deps.updateJob(job.id, { status: "failed", notice: `The search didn't finish (${status ?? "its batch is gone"}). Give me the job again.` }, ["searching"]);
      }
    });
  }
  for (const job of await deps.jobs(["planning"])) {
    if (now - Date.parse(job.updated_at) > PLANNING_STALE_MS) await guard(job.id, () => deps.plan(job.id));
  }

  const state = { formsLeft: FORMS_PER_TICK };
  for (const job of await deps.jobs(["running"])) {
    // Approve claims "running" first and writes the schedule after: until approved_at is set the rows have no day 0,
    // so the job is left alone (it must not be read as "nothing left to do"). An approval that never finished is undone.
    if (!job.approved_at) {
      if (now - Date.parse(job.updated_at) > APPROVE_STALE_MS) {
        await guard(job.id, async () => {
          await deps.abortApproval(job);
          await deps.updateJob(job.id, { status: "review", notice: "The approval didn't finish, so nothing is running. Approve it again.", email_campaign_id: null }, ["running"]);
        });
      }
      continue;
    }
    out.jobs++;
    await guard(job.id, () => runJob(job, now, deps, state, out));
  }
  if (out.jobs || out.notes.length) log.info({ ...out }, "brain.run_done");
  return out;
}
