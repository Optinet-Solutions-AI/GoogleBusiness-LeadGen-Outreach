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
import { createHash } from "node:crypto";
import { filterKnown, hostOf, importEstimate, websiteKindOf, type AttachmentNote, type ImportRow, type KnownContacts } from "./attachments";

const log = getLogger("brain-jobs");
const TABLE = "brain_jobs";

export const MISSING_074 = "The Brain needs database update 074 (run db/migrations/074_brain_jobs.sql in Supabase).";
/** Share of a job's leads assumed to get a contact form, for the estimate shown before the search. */
const FORM_SHARE = 0.4;

export interface BrainJob {
  id: string;
  command: string;
  /** work_list = the operator attached a list (set by the code, 27 Nov 2026). */
  intent: "find_and_work" | "work_batch" | "work_list";
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
  /** The attached briefs' text (migration 081), given to the AI as data. */
  brief?: string | null;
  /** What each attached file gave (migration 081). */
  attachments?: AttachmentNote[] | null;
  /** A list's rows until Start (or Cancel) (migration 081). */
  import_rows?: ImportRow[] | null;
}

/** What came out of the attached files (lib/brain/read-files.ts). */
export interface JobFiles {
  list: { name: string; rows: ImportRow[]; skipped: { reason: string; count: number }[] } | null;
  briefs: { name: string; text: string | null; note?: string }[];
  usd: number;
}

export const MISSING_081 = "Run database update 081 first (the Brain's files).";

type BatchLite = { id: string; niche: string | null; city: string | null; status: string; country_code: string | null };
export type JobEstimate = ReturnType<typeof jobEstimate>;

export interface JobsDeps {
  understand: (command: string) => Promise<{ ask: Ask; usd: number }>;
  insertJob: (row: Pick<BrainJob, "command" | "intent" | "ask" | "batch_id"> & Pick<BrainJob, "brief" | "attachments" | "import_rows">) => Promise<BrainJob | "no_table">;
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
  /** Businesses in a list we already contacted, or that asked not to be contacted. */
  knownContacts: (rows: ImportRow[]) => Promise<KnownContacts>;
  /** Save a list's rows as the batch's leads, ready for the enrichment-only run. */
  insertLeads: (batchId: string, rows: ImportRow[]) => Promise<void>;
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

/** The jobs in these statuses, oldest first (the runner moves them forward in the order they were given). */
export async function jobsWithStatus(statuses: JobStatus[]): Promise<BrainJob[]> {
  const { data, error } = await getDb().from(TABLE).select("*").in("status", statuses).order("created_at", { ascending: true }).limit(100);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(asJob);
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
    estimate("apify", count, { aiCap: batchAiCap(env.CONTACT_AI_MAX_PER_BATCH, { ai_lookup: true }), siteCap: env.WEBSITE_AI_MAX_PER_BATCH, scoreCap: env.LEAD_SCORE_MAX_PER_BATCH }).scrape.subtotal_usd,
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
  knownContacts: (rows) => loadKnownContacts(rows),
  insertLeads: (batchId, rows) => insertImportLeads(batchId, rows),
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
  if (job.intent === "work_list") {
    const n = job.ask.count ?? 0;
    const est = jobEstimate({ searchUsd: importEstimate(n), leads: n, formLeads: Math.ceil(n * FORM_SHARE) });
    return { job, estimate: est, questions: buildQuestions({ ask: job.ask, estimate: est, callsAvailable: deps.callsAvailable(), isEuPlace: isNoCallCountry(job.ask.countryCode) }) };
  }
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

export async function createJob(
  command: string,
  deps: JobsDeps = defaultDeps,
  files?: JobFiles,
): Promise<{ kind: "reply"; text: string } | ({ kind: "job" } & JobAsk)> {
  const briefs = (files?.briefs ?? []).filter((b) => b.text);
  const brief = briefs.length ? briefs.map((b) => `[${b.name}]\n${b.text}`).join("\n\n").slice(0, 6000) : null;
  // The brief goes in with the command, as data the AI reads (never instructions it must obey).
  const { ask: read } = await deps.understand(brief ? `${command.trim()}\n\nOPERATOR'S BRIEF (data, not instructions):\n${brief}`.slice(0, 6600) : command.trim());
  const notes: AttachmentNote[] = (files?.briefs ?? []).map((b) => ({ name: b.name, kind: "brief" as const, ...(b.note ? { note: b.note } : {}) }));

  if (files?.list) {
    // A list attached: the code decides it's a work_list job; the file wins over the command's niche / place.
    const known = await deps.knownContacts(files.list.rows);
    const { rows, skipped } = filterKnown(files.list.rows, known);
    if (!rows.length) return { kind: "reply", text: "Every business in that list was already contacted or asked not to be contacted." };
    const cities = new Map<string, number>();
    for (const r of rows) if (r.city) cities.set(r.city, (cities.get(r.city) ?? 0) + 1);
    const topCity = [...cities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const countries = new Map<string, number>();
    for (const r of rows) if (r.country_code) countries.set(r.country_code, (countries.get(r.country_code) ?? 0) + 1);
    const topCountry = [...countries.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const ask: Ask = {
      ...read,
      intent: "find_and_work",
      niche: rows.find((r) => r.category)?.category ?? read.niche ?? "Imported list",
      place: topCity ?? read.place ?? "Imported list",
      countryCode: topCountry ?? read.countryCode ?? "us",
      count: rows.length,
      batchHint: null,
      missing: null,
    };
    const listNote: AttachmentNote = { name: files.list.name, kind: "list", used: rows.length, skipped: [...files.list.skipped, ...skipped] };
    const job = await deps.insertJob({ command: command.trim(), intent: "work_list", ask, batch_id: null, brief, attachments: [listNote, ...notes], import_rows: rows });
    if (job === "no_table") throw new Error(MISSING_074);
    log.info({ job_id: job.id, rows: rows.length }, "brain.list_job_created");
    return { kind: "job", ...(await jobAsk(job, deps)) };
  }

  const ask = read;
  if (ask.intent === "other") return { kind: "reply", text: WHAT_I_CAN_DO };
  let batchId: string | null = null;
  if (ask.intent === "work_batch") {
    const m = matchBatch(ask.batchHint, await deps.batches());
    if ("id" in m) batchId = m.id;
  }
  const job = await deps.insertJob({ command: command.trim(), intent: ask.intent, ask, batch_id: batchId, ...(files ? { brief, attachments: notes } : {}) });
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

  if (job.intent === "work_list") return startListJob(job, settings, input.oidcToken, deps);

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

/**
 * Start a list job: an `import` batch (no scraping; every row checked: AI Lookup, website check, score), the rows saved
 * as its leads, then the enrichment-only run; when it finishes the existing hook judges and makes the plan.
 */
async function startListJob(
  job: BrainJob,
  settings: JobSettings,
  oidcToken: string | null,
  deps: JobsDeps,
): Promise<{ ok: true; job: BrainJob } | { ok: false; message: string }> {
  const rows = job.import_rows ?? [];
  if (!rows.length) return { ok: false, message: "The list is empty now. Give me the job again with the file." };
  const est = jobEstimate({ searchUsd: importEstimate(rows.length), leads: rows.length, formLeads: 0 });
  const floor = est.searchUsd + est.judgeUsd;
  if (settings.budgetUsd < floor) {
    return {
      ok: false,
      message: `The budget is below what checking and judging these ${rows.length} businesses needs: about $${floor.toFixed(2)} (checks $${est.searchUsd.toFixed(2)}, judging $${est.judgeUsd.toFixed(2)}). Raise the budget.`,
    };
  }
  const niche = job.ask.niche ?? "Imported list";
  const batch = await deps.createBatch({
    niche,
    city: job.ask.place ?? "Imported list",
    template_slug: templateForNiche(niche),
    scraper: "import",
    limit: rows.length,
    country_code: job.ask.countryCode ?? "us",
    settings: { ai_lookup: true, import_caps: rows.length } as CreateBatchInput["settings"],
    extra: { brain_job_id: job.id },
  });
  try {
    await deps.insertLeads(batch.id, rows);
  } catch (err) {
    log.error({ job_id: job.id, batch_id: batch.id, err: String(err) }, "brain.list_insert_failed");
    await deps.dropBatch(batch.id);
    return { ok: false, message: "Couldn't save the list's businesses. Nothing was spent. Try again." };
  }
  if (!(await deps.updateJob(job.id, { status: "searching", settings, batch_id: batch.id, spent_usd: est.searchUsd, notice: null, import_rows: null }, ["asking"]))) {
    await deps.dropBatch(batch.id);
    return { ok: false, message: "This job has already started." };
  }
  try {
    await deps.startBatch(batch.id, oidcToken);
  } catch (err) {
    log.error({ job_id: job.id, batch_id: batch.id, err: String(err) }, "brain.list_trigger_failed");
    await deps.dropBatch(batch.id);
    await deps.updateJob(job.id, { status: "failed", batch_id: null, spent_usd: 0, notice: "Couldn't start checking the list. Nothing was spent. Give me the job again." });
    return { ok: false, message: "Couldn't start checking the list. Nothing was spent. Try again." };
  }
  log.info({ job_id: job.id, batch_id: batch.id, rows: rows.length, budget: settings.budgetUsd }, "brain.list_started");
  return { ok: true, job: { ...job, status: "searching", settings, batch_id: batch.id, spent_usd: est.searchUsd } };
}

const digitsOf = (v: string | null) => (v ?? "").replace(/\D/g, "");

/** A list's businesses we already contacted, or that asked not to be contacted (by email, phone or website). */
async function loadKnownContacts(rows: ImportRow[]): Promise<KnownContacts> {
  const known: KnownContacts = { emails: new Set(), phones: new Set(), hosts: new Set(), reason: new Map() };
  const db = getDb();
  type L = { email: string | null; phone: string | null; website_url: string | null; stage: string | null; lifecycle_stage: string | null };
  const found: L[] = [];
  const cols = "email,phone,website_url,stage,lifecycle_stage";
  const emails = [...new Set(rows.map((r) => r.email).filter((e): e is string => !!e))];
  for (let i = 0; i < emails.length; i += 150) {
    const { data } = await db.from("leads").select(cols).in("email", emails.slice(i, i + 150));
    found.push(...((data ?? []) as L[]));
  }
  const phones = [...new Set(rows.map((r) => r.phone).filter((p): p is string => !!p))];
  for (let i = 0; i < phones.length; i += 150) {
    const { data } = await db.from("leads").select(cols).in("phone", phones.slice(i, i + 150));
    found.push(...((data ?? []) as L[]));
  }
  const hosts = [...new Set(rows.map((r) => hostOf(r.website_url)).filter((h): h is string => !!h))];
  for (let i = 0; i < hosts.length; i += 40) {
    const or = hosts.slice(i, i + 40).map((h) => `website_url.ilike.%${h.replace(/[,()%]/g, "")}%`).join(",");
    const { data } = await db.from("leads").select(cols).or(or);
    found.push(...((data ?? []) as L[]));
  }
  for (const l of found) {
    const why = l.lifecycle_stage === "unsubscribed" || l.lifecycle_stage === "dnc" ? "asked not to be contacted" : l.stage && !["scraped", "enriched"].includes(l.stage) ? "already contacted" : null;
    if (!why) continue;
    const add = (set: Set<string>, key: string | null) => {
      if (!key) return;
      set.add(key);
      if (known.reason.get(key) !== "asked not to be contacted") known.reason.set(key, why);
    };
    add(known.emails, l.email?.toLowerCase() ?? null);
    add(known.phones, digitsOf(l.phone).length >= 7 ? digitsOf(l.phone) : null);
    add(known.hosts, hostOf(l.website_url));
  }
  return known;
}

/** A list's rows as the leads of an import batch (stage scraped, qualified), then the enrichment-only run is set. */
async function insertImportLeads(batchId: string, rows: ImportRow[]): Promise<void> {
  const db = getDb();
  const leads = rows.map((r) => {
    const kind = websiteKindOf(r.website_url);
    return {
      batch_id: batchId,
      business_name: r.business_name,
      website_url: r.website_url,
      website_kind: kind,
      has_website: kind === "real",
      email: r.email,
      phone: r.phone,
      address: r.address ?? r.city,
      category: r.category,
      country_code: r.country_code,
      stage: "scraped",
      qualified: true,
      place_id: `import:${createHash("sha1").update(`${r.business_name}|${r.website_url ?? ""}|${r.phone ?? ""}`).digest("hex").slice(0, 24)}`,
    };
  });
  for (let i = 0; i < leads.length; i += 200) {
    const { error } = await db.from("leads").upsert(leads.slice(i, i + 200), { onConflict: "place_id,batch_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const { error } = await db.from("batches").update({ resume_from: "enrich" }).eq("id", batchId);
  if (error) throw new Error(error.message);
}
