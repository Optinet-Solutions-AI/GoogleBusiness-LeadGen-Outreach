/**
 * brain/plan.ts — the Brain judges each lead of a job's batch and saves the plan the operator will approve.
 *
 * Inputs:  job id (or the batch a search just finished); the batch's qualified leads, what was already sent / tried,
 *          Voizo's scripts; one OpenAI call per lead that can be reached (lib/services/openai-brain.ts, ~1 cent)
 * Outputs: brain_job_leads rows (decision, offer, channels, the allowed lists, reason, source); the job's spend; the
 *          job in "review" with a plain notice when the AI was off, the budget ran out, or nobody can be contacted
 * Used by: lib/pipeline/orchestrator.ts (planJobForBatch at the end of a batch run), scripts/cloud-run-job.ts
 *          (MODE=brain STEP=plan), app/api/brain/jobs/[id]/route.ts (loadPlan), lib/brain/{approve,runner}.ts
 *
 * The code decides first (lib/brain/judge.ts leadFacts → rules.ts allowedMoves): a lead that can't be reached, or that
 * the rules exclude, is skipped without asking the AI. The AI's answer is kept only inside the allowed lists
 * (validateDecision). Nothing is sent here.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { brainJson, isBrainConfigured } from "@/lib/services/openai-brain";
import { isVoizoConfigured, listScripts } from "@/lib/services/voizo";
import { getJob, updateJob, addSpend, type BrainJob } from "./jobs";
import { JUDGE_SCHEMA, judgeInput, judgeInstructions, leadFacts, type FactsContext, type JudgeLead } from "./judge";
import { JUDGE_USD_PER_LEAD, allowedMoves, canSpend, defaultDecision, validateDecision, type Channel, type Decision, type JobStatus } from "./rules";

const log = getLogger("brain-plan");
const POOL = 5;

export const NOTICE_AI_OFF = "AI wasn't available, so this plan uses the standard rules.";
export const NOTICE_BUDGET = "The budget was reached while judging, so the rest of this plan uses the standard rules.";

export interface SavedRow {
  job_id: string;
  lead_id: string;
  decision: "contact" | "skip";
  offer: string | null;
  channels: Channel[];
  allowed_offers: string[];
  allowed_channels: Channel[];
  reason: string;
  source: "ai" | "rule" | "default";
  approved: boolean;
}

/** A plan row as the page shows it: the decision plus how far the automatic steps got. */
export interface PlanRow extends SavedRow {
  business_name: string;
  verdict: string | null;
  first_touch_at: string | null;
  form_state: string | null;
  call_due_at: string | null;
  call_state: string | null;
  outcome: string | null;
  outcome_reason: string | null;
}

export interface PlanDeps {
  getJob: (id: string) => Promise<BrainJob | null>;
  updateJob: (id: string, patch: Partial<BrainJob>, onlyIfStatus?: JobStatus[]) => Promise<boolean>;
  addSpend: (id: string, usd: number) => Promise<number>;
  /** The job (still searching) that started this batch. */
  jobForBatch: (batchId: string) => Promise<BrainJob | null>;
  /** The batch's leads, without the ones its filters rejected. */
  loadLeads: (batchId: string) => Promise<JudgeLead[]>;
  batchCity: (batchId: string) => Promise<string | null>;
  context: (leadIds: string[], jobId: string) => Promise<FactsContext>;
  configured: () => boolean;
  judge: (input: string) => Promise<{ data: unknown; usd: number }>;
  saveRows: (jobId: string, rows: SavedRow[]) => Promise<void>;
}

const LEAD_COLS =
  "id,business_name,email,verification_status,qualified,lifecycle_stage,stage,seq_status,country_code,call_segment," +
  "website_kind,has_website,needs_improvement,signal_type,signal_meta,contact_owner_name,category,demo_url,ai_profile," +
  "phone,call_status,primary_offer,website_url,contact_page_url,rating,review_count,address,website_review";

async function idsIn(table: "outreach_events" | "contact_form_runs", ids: string[], kind?: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    let q = getDb().from(table).select("lead_id").in("lead_id", ids.slice(i, i + 150));
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q;
    // A failed read must never look like "never contacted": stop the planning instead.
    if (error) throw new Error(`can't read ${table}: ${error.message}`);
    for (const r of (data ?? []) as { lead_id: string }[]) out.add(r.lead_id);
  }
  return out;
}

/** What is already known about these leads: emailed, tried by form, in another running job; Voizo's offers. */
export async function loadFactsContext(leadIds: string[], jobId: string): Promise<FactsContext> {
  const db = getDb();
  const [emailed, triedForm] = await Promise.all([
    idsIn("outreach_events", leadIds, "email_sent"),
    idsIn("contact_form_runs", leadIds),
  ]);
  const inOtherJob = new Set<string>();
  const { data: live, error } = await db.from("brain_jobs").select("id").in("status", ["review", "running", "paused"]).neq("id", jobId);
  if (error) throw new Error(`can't read brain_jobs: ${error.message}`);
  const liveIds = ((live ?? []) as { id: string }[]).map((j) => j.id);
  if (liveIds.length) {
    for (let i = 0; i < leadIds.length; i += 150) {
      const { data, error: e } = await db.from("brain_job_leads").select("lead_id").in("job_id", liveIds).eq("decision", "contact").in("lead_id", leadIds.slice(i, i + 150));
      if (e) throw new Error(`can't read brain_job_leads: ${e.message}`);
      for (const r of (data ?? []) as { lead_id: string }[]) inOtherJob.add(r.lead_id);
    }
  }
  let callOffers: string[] = [];
  if (isVoizoConfigured()) {
    const s = await listScripts().catch(() => null);
    if (s?.ok) callOffers = s.data.scripts.filter((x) => x.offerKey && x.canDial !== false).map((x) => x.offerKey!);
  }
  return { emailed, triedForm, inOtherJob, callOffers };
}

export async function loadJobLeads(batchId: string): Promise<JudgeLead[]> {
  const out: JudgeLead[] = [];
  for (let from = 0; from < 2000; from += 1000) {
    const { data, error } = await getDb().from("leads").select(LEAD_COLS).eq("batch_id", batchId).order("created_at", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as JudgeLead[];
    out.push(...rows.filter((l) => l.qualified !== false));
    if (rows.length < 1000) break;
  }
  return out;
}

const defaultDeps: PlanDeps = {
  getJob,
  updateJob,
  addSpend,
  jobForBatch: async (batchId) => {
    const { data, error } = await getDb().from("brain_jobs").select("id").eq("batch_id", batchId).eq("status", "searching").limit(1).maybeSingle();
    if (error || !data) return null;
    return getJob((data as { id: string }).id);
  },
  loadLeads: loadJobLeads,
  batchCity: async (batchId) => {
    const { data } = await getDb().from("batches").select("city").eq("id", batchId).maybeSingle();
    return (data as { city: string | null } | null)?.city ?? null;
  },
  context: loadFactsContext,
  configured: isBrainConfigured,
  judge: (input) => brainJson<unknown>({ name: "brain_judge", instructions: judgeInstructions(), input, schema: JUDGE_SCHEMA, maxOutputTokens: 300 }),
  saveRows: async (jobId, rows) => {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await getDb().from("brain_job_leads").upsert(rows.slice(i, i + 200).map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "job_id,lead_id" });
      if (error) throw new Error(`can't save the plan: ${error.message}`);
    }
    log.info({ job_id: jobId, rows: rows.length }, "brain.plan_saved");
  },
};

/** Judge every lead of the job's batch and save the plan. Only from "searching" / "planning"; anything else: nothing. */
export async function buildPlan(jobId: string, deps: PlanDeps = defaultDeps): Promise<{ rows: number; contact: number; usd: number }> {
  const nothing = { rows: 0, contact: 0, usd: 0 };
  if (!(await deps.updateJob(jobId, { status: "planning" }, ["searching", "planning"]))) return nothing;
  const job = await deps.getJob(jobId);
  if (!job?.batch_id) return nothing;

  const [leads, place] = await Promise.all([deps.loadLeads(job.batch_id), deps.batchCity(job.batch_id)]);
  const ctx = await deps.context(leads.map((l) => l.id), jobId);
  const decisions = new Map<string, { d: Decision; offers: string[]; channels: Channel[] }>();
  const toJudge: { lead: JudgeLead; facts: ReturnType<typeof leadFacts>; moves: ReturnType<typeof allowedMoves> }[] = [];
  for (const lead of leads) {
    const facts = leadFacts(lead, job.settings, ctx);
    const moves = allowedMoves(facts, job.settings);
    if (moves.skip) decisions.set(lead.id, { d: defaultDecision(moves, facts), offers: moves.offers, channels: moves.channels });
    else toJudge.push({ lead, facts, moves });
  }

  let usd = 0;
  let asked = 0; // dispatched (each reserved at about 1 cent, so parallel calls can't overshoot the budget)
  let failed = 0;
  let answered = 0;
  let aiOff = !deps.configured();
  let budgetHit = false;
  const queue = [...toJudge];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const { lead, facts, moves } = item;
      const fallback = () => decisions.set(lead.id, { d: defaultDecision(moves, facts), offers: moves.offers, channels: moves.channels });
      if (aiOff) {
        fallback();
        continue;
      }
      if (!canSpend(job.spent_usd + asked * JUDGE_USD_PER_LEAD, JUDGE_USD_PER_LEAD, job.settings.budgetUsd)) {
        budgetHit = true;
        fallback();
        continue;
      }
      asked++;
      try {
        const r = await deps.judge(judgeInput({ lead, moves, place }));
        usd += r.usd;
        answered++;
        decisions.set(lead.id, { d: validateDecision(r.data, moves, facts), offers: moves.offers, channels: moves.channels });
      } catch (err) {
        failed++;
        log.warn({ job_id: jobId, lead_id: lead.id, err: String(err).slice(0, 200) }, "brain.judge_failed");
        fallback();
        // Three failures and not one answer: the AI is down. The rest use the rules (no more paid attempts).
        if (failed >= 3 && answered === 0) aiOff = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, queue.length) }, worker));

  const rows: SavedRow[] = leads.map((l) => {
    const x = decisions.get(l.id)!;
    return {
      job_id: jobId,
      lead_id: l.id,
      decision: x.d.contact ? "contact" : "skip",
      offer: x.d.offer,
      channels: x.d.channels,
      allowed_offers: x.offers,
      allowed_channels: x.channels,
      reason: x.d.reason,
      source: x.d.source,
      approved: x.d.contact,
    };
  });
  // The cost first: if saving the plan fails and the judging is run again, the budget already knows what was spent.
  usd = Math.round(usd * 1e4) / 1e4;
  await deps.addSpend(jobId, usd);
  await deps.saveRows(jobId, rows);

  const contact = rows.filter((r) => r.decision === "contact").length;
  let notice: string | null = null;
  if (!contact) {
    const why = new Map<string, number>();
    for (const r of rows) why.set(r.reason, (why.get(r.reason) ?? 0) + 1);
    const top = [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, n]) => `${n} × ${reason}`);
    notice = `Nothing to contact in this batch: ${top.join("; ") || "it has no usable leads"}.`;
  } else if (aiOff && toJudge.length) notice = NOTICE_AI_OFF;
  else if (budgetHit) notice = NOTICE_BUDGET;
  await deps.updateJob(jobId, { status: "review", notice }, ["planning"]);
  log.info({ job_id: jobId, rows: rows.length, contact, asked, failed, usd, ai_off: aiOff, budget_hit: budgetHit }, "brain.plan_built");
  return { rows: rows.length, contact, usd };
}

/**
 * The hook at the end of a batch run: plan the Brain job that started this batch. An ordinary batch: nothing.
 * A search that failed or was cancelled fails the job; a paused one waits for its resume. Never throws.
 */
export async function planJobForBatch(batchId: string, status: string, deps: PlanDeps = defaultDeps): Promise<void> {
  try {
    const job = await deps.jobForBatch(batchId);
    if (!job) return;
    if (status === "paused") return;
    if (status !== "done") {
      await deps.updateJob(job.id, { status: "failed", notice: `The search didn't finish (${status}). Give me the job again, or work the batch as it is.` }, ["searching"]);
      return;
    }
    await buildPlan(job.id, deps);
  } catch (err) {
    log.error({ batch_id: batchId, err: String(err) }, "brain.plan_for_batch_failed");
  }
}

/** The plan as the page shows it (decision + progress), contact rows first. */
export async function loadPlan(jobId: string): Promise<PlanRow[]> {
  const { data, error } = await getDb()
    .from("brain_job_leads")
    .select("*, leads(business_name, verdict:website_review->>verdict)")
    .eq("job_id", jobId)
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as unknown as (PlanRow & { leads: { business_name: string; verdict: string | null } | null })[]).map(({ leads, ...r }) => ({
    ...r,
    business_name: leads?.business_name ?? "(lead removed)",
    verdict: leads?.verdict ?? null,
  }));
  return rows.sort((a, b) => Number(b.decision === "contact") - Number(a.decision === "contact") || a.business_name.localeCompare(b.business_name));
}
