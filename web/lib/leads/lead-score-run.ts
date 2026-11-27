/**
 * leads/lead-score-run.ts — score one lead with OpenAI, and "Score again" on the lead page (27 Nov 2026).
 *
 * Inputs:  a lead row (ScoreLead) or a lead id; OPENAI_SCORE_MODEL via lib/services/openai-brain.ts brainJson
 * Outputs: scoreLead → LeadScore | null · scoreFields → the three columns saved on the lead (migration 076) ·
 *          rescoreLead(id) → scores and saves one lead, refused within 2 minutes of the last score
 * Used by: lib/pipeline/stage-1-scrape.ts (during scraping), lib/leads/lead-score-batch.ts (Score this batch),
 *          app/api/leads/[id]/lead-score/route.ts (Score again)
 *
 * The AI reads facts only (lib/leads/lead-score.ts scoreInput): no email address, no phone number. No web search.
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getDb } from "@/lib/db";
import { brainJson } from "@/lib/services/openai-brain";
import { factsFromLead, parseScore, SCORE_INSTRUCTIONS, SCORE_SCHEMA, scoreInput, scoreWait, type LeadScore, type ScoreLead } from "./lead-score";

/** Lead columns added by migration 076 (dropped from a save when it isn't applied yet). */
export const SCORE_COLS = ["lead_score", "lead_score_detail", "lead_scored_at"] as const;

/** The lead fields scoring reads (= ScoreLead). */
export const SCORE_LEAD_COLS =
  "id,business_name,category,address,country_code,rating,review_count,email,verification_status,phone,contact_page_url," +
  "contact_owner_name,website_url,website_review,ai_profile,signal_type,signal_meta,call_segment,has_website,website_kind," +
  "needs_improvement,primary_offer";

export class ScoreTooSoonError extends Error {
  constructor(readonly waitSeconds: number) {
    super(`This lead was just scored. So you don't pay twice, it can be scored again in ${waitSeconds} seconds.`);
    this.name = "ScoreTooSoonError";
  }
}

export function scoreFields(s: LeadScore): { lead_score: number; lead_score_detail: LeadScore; lead_scored_at: string } {
  return { lead_score: s.score, lead_score_detail: s, lead_scored_at: s.scored_at };
}

type Deps = { ask?: typeof brainJson; now?: () => Date };

/** One OpenAI call. null = the answer couldn't be used; BrainError on a dead key / no credit / failure. */
export async function scoreLead(lead: ScoreLead, deps: Deps = {}): Promise<LeadScore | null> {
  const ask = deps.ask ?? brainJson;
  const { data, usd } = await ask<unknown>({
    name: "lead_score",
    model: env.OPENAI_SCORE_MODEL,
    instructions: SCORE_INSTRUCTIONS,
    input: scoreInput(factsFromLead(lead)),
    schema: SCORE_SCHEMA,
    maxOutputTokens: 400,
  });
  return parseScore(data, { model: env.OPENAI_SCORE_MODEL, usd, scored_at: (deps.now?.() ?? new Date()).toISOString() });
}

const missing076 = (msg: string) => SCORE_COLS.some((c) => msg.includes(c));

/** The lead page's saved score (free). Throws "missing 076" without the column. */
export async function loadLeadScore(leadId: string): Promise<LeadScore | null> {
  const { data, error } = await getDb().from("leads").select("lead_score_detail").eq("id", leadId).maybeSingle();
  if (error) throw new Error(missing076(error.message) ? "missing 076" : error.message);
  return ((data as { lead_score_detail?: LeadScore | null } | null)?.lead_score_detail ?? null) as LeadScore | null;
}

/** "Score again": load, refuse within 2 minutes of the last score, score, save. */
export async function rescoreLead(leadId: string, deps: Deps = {}): Promise<LeadScore> {
  const db = getDb();
  const { data, error } = await db.from("leads").select(`${SCORE_LEAD_COLS},lead_scored_at`).eq("id", leadId).maybeSingle();
  if (error) throw new Error(missing076(error.message) ? "missing 076" : error.message);
  if (!data) throw new Error("not found");
  const lead = data as unknown as ScoreLead & { lead_scored_at: string | null };
  const now = deps.now?.() ?? new Date();
  const wait = scoreWait(lead.lead_scored_at, now);
  if (wait) throw new ScoreTooSoonError(wait);
  // Claim it first (two tabs pressing at once: only one pays). A failed score still waits the 2 minutes.
  const since = new Date(now.getTime() - 120_000).toISOString();
  const { data: claimed, error: claimErr } = await db
    .from("leads")
    .update({ lead_scored_at: now.toISOString() })
    .eq("id", leadId)
    .or(`lead_scored_at.is.null,lead_scored_at.lt.${since}`)
    .select("id");
  if (claimErr) throw new Error(missing076(claimErr.message) ? "missing 076" : claimErr.message);
  if (!(claimed ?? []).length) throw new ScoreTooSoonError(120);
  const score = await scoreLead(lead, deps);
  if (!score) throw new Error("no score");
  const { error: saveErr } = await db.from("leads").update(scoreFields(score)).eq("id", leadId);
  if (saveErr) throw new Error(missing076(saveErr.message) ? "missing 076" : saveErr.message);
  return score;
}
