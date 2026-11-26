/**
 * brain/jobs.ts — Brain jobs: a command typed in plain words becomes a job, gets its questions, and starts.
 *
 * Inputs:  the command (OpenAI understands it: lib/services/openai-brain.ts), the operator's answers; brain_jobs
 *          (migration 074), batches, call_campaigns; lib/pricing.ts for the search estimate
 * Outputs: brain_jobs rows; on start: a tagged batch run on Cloud Run (find and work) or the planning step (existing
 *          batch); plain refusals instead of exceptions for anything the operator can fix
 * Used by: app/api/brain/jobs/**, lib/brain/{plan,approve,runner,control}.ts, app/(dashboard)/brain/page.tsx
 *
 * Nothing here contacts a lead. A search costs money, so it starts only from startJob, after the questions, with the
 * budget checked against the estimate, and exactly once (asking → searching is one conditional update).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { estimate } from "@/lib/pricing";
import { batchAiCap } from "@/lib/batch-settings";
import { templateForNiche } from "@/lib/data/niches";
import { createBatch, type CreateBatchInput } from "@/lib/pipeline/orchestrator";
import { triggerBatchJob, triggerJob } from "@/lib/services/cloud-run";
import { brainJson } from "@/lib/services/openai-brain";
import { isVoizoConfigured } from "@/lib/services/voizo";
import { isNoCallCountry } from "@/lib/leads/contact-readiness";
import { COMMAND_SCHEMA, WHAT_I_CAN_DO, buildQuestions, commandInstructions, matchBatch, parseAsk, type Ask, type Question } from "./command";
import { cleanSettings, jobEstimate, type JobSettings, type JobStatus } from "./rules";

const log = getLogger("brain-jobs");
const TABLE = "brain_jobs";

export const MISSING_074 = "The Brain needs database update 074 (run db/migrations/074_brain_jobs.sql in Supabase).";
/** Share of a job's leads assumed to get a contact form, for the estimate shown before the search. */
const FORM_SHARE = 0.4;

export interface BrainJob {
  id: string;
  command: string;
  intent: "find_and_work" | "work_batch";
  status: JobStatus;
  ask: Ask;
  settings: JobSettings;
  batch_id: string | null;
  email_campaign_id: string | null;
  spent_usd: number;
  notice: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

type BatchLite = { id: string; niche: string | null; city: string | null; status: string; country_code: string | null };
export type JobEstimate = ReturnType<typeof jobEstimate>;

export interface JobsDeps {
  understand: (command: string) => Promise<{ ask: Ask; usd: number }>;
  insertJob: (row: Pick<BrainJob, "command" | "intent" | "ask" | "batch_id">) => Promise<BrainJob | "no_table">;
  getJob: (id: string) => Promise<BrainJob | null>;
  /** With `onlyIfStatus`, one conditional update: false when the job was no longer in one of those statuses. */
  updateJob: (id: string, patch: Partial<BrainJob>, onlyIfStatus?: JobStatus[]) => Promise<boolean>;
  /** Newest first. */
  batches: () => Promise<BatchLite[]>;
  batchLeadCount: (batchId: string) => Promise<number>;
  /** Why this batch can't be given to the Brain right now (plain words), or null. */
  batchBusy: (batchId: string) => Promise<string | null>;
  /** The search + AI checks estimate for this many leads. */
  searchUsd: (count: number) => number;
  callsAvailable: () => boolean;
  createBatch: (input: CreateBatchInput) => Promise<{ id: string }>;
  /** A batch that was created but never ran. */
  dropBatch: (batchId: string) => Promise<void>;
  startBatch: (batchId: string, oidcToken: string | null) => Promise<void>;
  startPlan: (jobId: string, oidcToken: string | null) => Promise<void>;
}

/* ---------------------------------------------------------------- db ------------------------------------------- */

function isMissingTable(err: { message?: string; code?: string } | null | undefined): boolean {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || /brain_jobs|brain_job_leads/.test(err.message ?? "") && /does not exist|schema cache/i.test(err.message ?? ""));
}

const asJob = (r: Record<string, unknown>): BrainJob => ({ ...(r as unknown as BrainJob), spent_usd: Number(r.spent_usd ?? 0), settings: cleanSettings(r.settings) });

export async function listJobs(): Promise<{ jobs: BrainJob[]; missing: boolean }> {
  const { data, error } = await getDb().from(TABLE).select("*").order("created_at", { ascending: false }).limit(50);
  if (error) {
    if (isMissingTable(error)) return { jobs: [], missing: true };
    throw new Error(error.message);
  }
  return { jobs: ((data ?? []) as Record<string, unknown>[]).map(asJob), missing: false };
}

export async function getJob(id: string): Promise<BrainJob | null> {
  const { data, error } = await getDb().from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new Error(MISSING_074);
    throw new Error(error.message);
  }
  return data ? asJob(data as Record<string, unknown>) : null;
}

export async function updateJob(id: string, patch: Partial<BrainJob>, onlyIfStatus?: JobStatus[]): Promise<boolean> {
  let q = getDb().from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (onlyIfStatus?.length) q = q.in("status", onlyIfStatus);
  const { data, error } = await q.select("id");
  if (error) throw new Error(isMissingTable(error) ? MISSING_074 : error.message);
  return ((data as unknown[] | null) ?? []).length === 1;
}

/** Add to what the job has spent (read-then-write: only one worker handles a job at a time). */
export async function addSpend(id: string, usd: number): Promise<number> {
  if (!(usd > 0)) return (await getJob(id))?.spent_usd ?? 0;
  const job = await getJob(id);
  const spent = Math.round(((job?.spent_usd ?? 0) + usd) * 1e4) / 1e4;
  await updateJob(id, { spent_usd: spent });
  return spent;
}

const defaultDeps: JobsDeps = {
  understand: async (command) => {
    const r = await brainJson<unknown>({ name: "brain_command", instructions: commandInstructions(), input: command.slice(0, 600), schema: COMMAND_SCHEMA, maxOutputTokens: 400 });
    return { ask: parseAsk(r.data), usd: r.usd };
  },
  insertJob: async (row) => {
    const { data, error } = await getDb().from(TABLE).insert({ ...row, status: "asking" }).select("*").single();
    if (error) {
      if (isMissingTable(error)) return "no_table";
      throw new Error(error.message);
    }
    return asJob(data as Record<string, unknown>);
  },
  getJob,
  updateJob,
  batches: async () => {
    const { data, error } = await getDb().from("batches").select("id,niche,city,status,country_code").order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as BatchLite[];
  },
  batchLeadCount: async (batchId) => {
    const { count } = await getDb().from("leads").select("id", { count: "exact", head: true }).eq("batch_id", batchId).neq("qualified", false);
    return count ?? 0;
  },
  batchBusy: async (batchId) => {
    const db = getDb();
    const { data: camp } = await db.from("call_campaigns").select("name").eq("batch_id", batchId).eq("channel", "email").in("status", ["active", "paused", "building"]).limit(1);
    const name = ((camp ?? []) as { name: string }[])[0]?.name;
    if (name) return `This batch is already being emailed ("${name}"). Pause or cancel that on the Campaigns page first.`;
    const { data: b } = await db.from("batches").select("auto_email_state").eq("id", batchId).maybeSingle();
    if ((b as { auto_email_state?: string | null } | null)?.auto_email_state === "waiting") {
      return "This batch is set to email itself automatically. Cancel that on the batch page first.";
    }
    return null;
  },
  searchUsd: (count) =>
    estimate("apify", count, { aiCap: batchAiCap(env.CONTACT_AI_MAX_PER_BATCH, { ai_lookup: true }), siteCap: env.WEBSITE_AI_MAX_PER_BATCH }).scrape.subtotal_usd,
  callsAvailable: isVoizoConfigured,
  createBatch,
  dropBatch: async (batchId) => {
    const { error } = await getDb().from("batches").delete().eq("id", batchId).eq("status", "queued");
    if (error) log.warn({ batch_id: batchId, err: error.message }, "brain.drop_batch_failed");
  },
  startBatch: async (batchId, oidcToken) => {
    await triggerBatchJob(batchId, { oidcToken });
  },
  startPlan: async (jobId, oidcToken) => {
    await triggerJob({ MODE: "brain", STEP: "plan", JOB_ID: jobId }, { oidcToken, timeoutSeconds: 1800 });
  },
};

/* ---------------------------------------------------------------- questions ------------------------------------ */

export interface JobAsk {
  job: BrainJob;
  /** Present once nothing is missing (and, for an existing batch, the batch is known). */
  questions?: Question[];
  estimate?: JobEstimate;
  /** "Work this batch" with no single match: the finished batches to pick from. */
  candidates?: { id: string; label: string }[];
}

/** What to show for a job that is still being set up: the missing question, the batch list, or the settings. */
export async function jobAsk(job: BrainJob, deps: JobsDeps = defaultDeps): Promise<JobAsk> {
  if (job.status !== "asking") return { job };
  if (job.intent === "find_and_work") {
    if (job.ask.missing || !job.ask.count) return { job };
    const est = jobEstimate({ searchUsd: deps.searchUsd(job.ask.count), leads: job.ask.count, formLeads: Math.ceil(job.ask.count * FORM_SHARE) });
    return { job, estimate: est, questions: buildQuestions({ ask: job.ask, estimate: est, callsAvailable: deps.callsAvailable(), isEuPlace: isNoCallCountry(job.ask.countryCode) }) };
  }
  const batches = await deps.batches();
  if (!job.batch_id) {
    const m = matchBatch(job.ask.batchHint, batches);
    return { job, candidates: "candidates" in m ? m.candidates : [] };
  }
  const leads = await deps.batchLeadCount(job.batch_id);
  const est = jobEstimate({ searchUsd: 0, leads, formLeads: Math.ceil(leads * FORM_SHARE) });
  const batch = batches.find((b) => b.id === job.batch_id);
  return { job, estimate: est, questions: buildQuestions({ ask: job.ask, estimate: est, callsAvailable: deps.callsAvailable(), isEuPlace: isNoCallCountry(batch?.country_code ?? null) }) };
}

/* ---------------------------------------------------------------- create / refine / start ---------------------- */

export async function createJob(command: string, deps: JobsDeps = defaultDeps): Promise<{ kind: "reply"; text: string } | ({ kind: "job" } & JobAsk)> {
  const { ask } = await deps.understand(command.trim());
  if (ask.intent === "other") return { kind: "reply", text: WHAT_I_CAN_DO };
  let batchId: string | null = null;
  if (ask.intent === "work_batch") {
    const m = matchBatch(ask.batchHint, await deps.batches());
    if ("id" in m) batchId = m.id;
  }
  const job = await deps.insertJob({ command: command.trim(), intent: ask.intent, ask, batch_id: batchId });
  if (job === "no_table") throw new Error(MISSING_074);
  log.info({ job_id: job.id, intent: job.intent }, "brain.job_created");
  return { kind: "job", ...(await jobAsk(job, deps)) };
}

/** The operator answered the missing question, or picked the batch: update the job and show what comes next. */
export async function refineJob(
  id: string,
  input: { missing?: string; batchId?: string },
  deps: JobsDeps = defaultDeps,
): Promise<({ ok: true } & JobAsk) | { ok: false; message: string }> {
  const job = await deps.getJob(id);
  if (!job) return { ok: false, message: "Job not found." };
  if (job.status !== "asking") return { ok: false, message: "This job has already started." };
  if (input.batchId) {
    const batch = (await deps.batches()).find((b) => b.id === input.batchId && b.status === "done");
    if (!batch) return { ok: false, message: "Pick a finished batch from the list." };
    if (!(await deps.updateJob(id, { batch_id: batch.id }, ["asking"]))) return { ok: false, message: "This job has already started." };
    return { ok: true, ...(await jobAsk({ ...job, batch_id: batch.id }, deps)) };
  }
  const answer = (input.missing ?? "").trim();
  if (!answer) return { ok: false, message: "Type an answer first." };
  // The answer is read together with the original command, so "Texas" lands in the right place.
  const { ask } = await deps.understand(`${job.command}. ${answer}`.slice(0, 600));
  if (ask.intent !== job.intent) return { ok: false, message: "I couldn't fit that answer to the job. Start a new job with the full instruction." };
  if (!(await deps.updateJob(id, { ask }, ["asking"]))) return { ok: false, message: "This job has already started." };
  return { ok: true, ...(await jobAsk({ ...job, ask }, deps)) };
}

export async function startJob(
  id: string,
  input: { settings: unknown; oidcToken: string | null },
  deps: JobsDeps = defaultDeps,
): Promise<{ ok: true; job: BrainJob } | { ok: false; message: string }> {
  const job = await deps.getJob(id);
  if (!job) return { ok: false, message: "Job not found." };
  if (job.status !== "asking") return { ok: false, message: "This job has already started." };
  const settings = cleanSettings(input.settings);
  if (!deps.callsAvailable()) settings.channels.call = false;
  if (!settings.channels.email && !settings.channels.form && !settings.channels.call) return { ok: false, message: "Tick at least one way to contact them." };

  if (job.intent === "work_batch") {
    if (!job.batch_id) return { ok: false, message: "Pick the batch first." };
    const busy = await deps.batchBusy(job.batch_id);
    if (busy) return { ok: false, message: busy };
    if (!(await deps.updateJob(id, { status: "planning", settings, notice: null }, ["asking"]))) return { ok: false, message: "This job has already started." };
    try {
      await deps.startPlan(id, input.oidcToken);
    } catch (err) {
      log.error({ job_id: id, err: String(err) }, "brain.plan_trigger_failed");
      await deps.updateJob(id, { status: "asking", notice: "Couldn't start the worker. Try again." });
      return { ok: false, message: "Couldn't start the worker. Try again." };
    }
    return { ok: true, job: { ...job, status: "planning", settings } };
  }

  const { ask } = job;
  if (ask.missing || !ask.niche || !ask.place || !ask.count) return { ok: false, message: ask.missing ?? "The job isn't complete yet." };
  const est = jobEstimate({ searchUsd: deps.searchUsd(ask.count), leads: ask.count, formLeads: 0 });
  const floor = est.searchUsd + est.judgeUsd;
  if (settings.budgetUsd < floor) {
    return {
      ok: false,
      message: `The budget is below what the search and the judging need: about $${floor.toFixed(2)} (search and AI checks $${est.searchUsd.toFixed(2)}, judging $${est.judgeUsd.toFixed(2)}). Raise the budget or ask for fewer leads.`,
    };
  }
  const batch = await deps.createBatch({
    niche: ask.niche,
    city: ask.place,
    template_slug: templateForNiche(ask.niche),
    scraper: "apify",
    limit: ask.count,
    country_code: ask.countryCode ?? "us",
    // AI Lookup on; never "email this batch automatically": the Brain plans it instead.
    settings: { ai_lookup: true } as CreateBatchInput["settings"],
    extra: { brain_job_id: id },
  });
  // The search counts toward the budget at its estimate (the app records no actual search cost).
  if (!(await deps.updateJob(id, { status: "searching", settings, batch_id: batch.id, spent_usd: est.searchUsd, notice: null }, ["asking"]))) {
    await deps.dropBatch(batch.id);
    return { ok: false, message: "This job has already started." };
  }
  try {
    await deps.startBatch(batch.id, input.oidcToken);
  } catch (err) {
    log.error({ job_id: id, batch_id: batch.id, err: String(err) }, "brain.search_trigger_failed");
    await deps.dropBatch(batch.id);
    await deps.updateJob(id, { status: "failed", batch_id: null, spent_usd: 0, notice: "Couldn't start the search. Nothing was spent. Give me the job again." });
    return { ok: false, message: "Couldn't start the search. Nothing was spent. Try again." };
  }
  log.info({ job_id: id, batch_id: batch.id, count: ask.count, budget: settings.budgetUsd }, "brain.search_started");
  return { ok: true, job: { ...job, status: "searching", settings, batch_id: batch.id, spent_usd: est.searchUsd } };
}
