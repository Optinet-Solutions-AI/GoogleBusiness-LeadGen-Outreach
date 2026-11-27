/**
 * leads/lead-score-batch.ts — "Score this batch": score the leads of an older batch that have no score yet (27 Nov 2026).
 *
 * Inputs:  a batch id; LEAD_SCORE_MAX_PER_BATCH (the most leads one run scores)
 * Outputs: unscoredCount(batchId) (for the button's "Score N leads, about $X") · scoreBatch(batchId) →
 *          { scored, failed, usd }, each score saved on its lead (migration 076)
 * Used by: app/api/batches/[id]/lead-score/route.ts (the count), scripts/cloud-run-job.ts MODE=lead-score (the run)
 *
 * Runs on Cloud Run only after the operator confirmed the cost. 4 at a time, at most 12 minutes; a dead key or no
 * credit stops it. A lead that fails stays unscored (the button offers it again).
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { BrainError } from "@/lib/services/openai-brain";
import type { LeadScore, ScoreLead } from "./lead-score";
import { SCORE_LEAD_COLS, scoreFields, scoreLead } from "./lead-score-run";

const log = getLogger("lead-score-batch");
const AT_ONCE = 4;
const BUDGET_MS = 12 * 60_000;

/** Qualified leads of the batch with no score yet. */
function unscoredQuery(batchId: string, cols: string, head = false) {
  return getDb()
    .from("leads")
    .select(cols, head ? { count: "exact", head: true } : undefined)
    .eq("batch_id", batchId)
    .is("lead_score", null)
    .or("qualified.is.null,qualified.eq.true");
}

export async function unscoredCount(batchId: string): Promise<number> {
  const { count, error } = await unscoredQuery(batchId, "id", true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

type Deps = {
  cap?: number;
  load?: (batchId: string, cap: number) => Promise<ScoreLead[]>;
  score?: (lead: ScoreLead) => Promise<LeadScore | null>;
  save?: (leadId: string, s: LeadScore) => Promise<void>;
  now?: () => number;
};

async function loadUnscored(batchId: string, cap: number): Promise<ScoreLead[]> {
  const { data, error } = await unscoredQuery(batchId, SCORE_LEAD_COLS).order("created_at", { ascending: true }).limit(cap);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ScoreLead[];
}

async function saveScore(leadId: string, s: LeadScore): Promise<void> {
  const { error } = await getDb().from("leads").update(scoreFields(s)).eq("id", leadId);
  if (error) throw new Error(error.message);
}

export async function scoreBatch(batchId: string, deps: Deps = {}): Promise<{ scored: number; failed: number; usd: number }> {
  const cap = deps.cap ?? env.LEAD_SCORE_MAX_PER_BATCH;
  const now = deps.now ?? Date.now;
  const until = now() + BUDGET_MS;
  const queue = (await (deps.load ?? loadUnscored)(batchId, cap)).slice(0, cap);
  const score = deps.score ?? ((l: ScoreLead) => scoreLead(l));
  const save = deps.save ?? saveScore;
  const out = { scored: 0, failed: 0, usd: 0 };
  let stop = false;
  const worker = async () => {
    while (!stop && queue.length && now() < until) {
      const lead = queue.shift()!;
      try {
        const s = await score(lead);
        if (!s) {
          out.failed++;
          continue;
        }
        await save(lead.id, s);
        out.scored++;
        out.usd = Math.round((out.usd + s.usd) * 1e6) / 1e6;
      } catch (err) {
        out.failed++;
        if (err instanceof BrainError && (err.code === "key_invalid" || err.code === "no_credit" || err.code === "not_configured")) stop = true;
        log.warn({ batch_id: batchId, lead_id: lead.id, err: String(err).slice(0, 200) }, "lead_score_batch.lead_failed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker));
  log.info({ batch_id: batchId, ...out }, "lead_score_batch.done");
  return out;
}
