/**
 * api/leads/[id]/lead-score/route.ts — the lead page's lead score: read it, or "Score again".
 *
 * Inputs:  GET params.id · POST params.id (no body)
 * Outputs: GET  { score: LeadScore | null } (free)
 *          POST { score: LeadScore } — one OpenAI call (about half a cent, a few seconds); 429 + a plain sentence
 *               within 2 minutes of the last score; 503 when OpenAI or migration 076 is missing
 * Used by: components/leads/LeadScoreBox.tsx
 *
 * Thin: lib/leads/lead-score-run.ts. workflows/score_leads.md.
 */
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { getDb } from "@/lib/db";
import { isDbConfigured } from "@/lib/safe-db";
import { BrainError } from "@/lib/services/openai-brain";
import { rescoreLead, ScoreTooSoonError } from "@/lib/leads/lead-score-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MISSING_076 = "Run database update 076 first (lead score).";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const { data, error } = await getDb().from("leads").select("lead_score_detail").eq("id", params.id).maybeSingle();
  if (error) return /lead_score/.test(error.message) ? fail(MISSING_076, 503) : fail(error.message, 500);
  return ok({ score: (data as { lead_score_detail?: unknown } | null)?.lead_score_detail ?? null });
});

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  try {
    return ok({ score: await rescoreLead(params.id) });
  } catch (err) {
    if (err instanceof ScoreTooSoonError) return fail(err.message, 429);
    if (err instanceof BrainError) {
      if (err.code === "not_configured") return fail("Lead scoring isn't switched on (no OpenAI key). Ask the admin.", 503);
      if (err.code === "key_invalid" || err.code === "no_credit") return fail("OpenAI refused the request (key or credit). Ask the admin.", 503);
    }
    const msg = String(err instanceof Error ? err.message : err);
    if (msg === "not found") return fail("Lead not found", 404);
    if (msg === "missing 076") return fail(MISSING_076, 503);
    if (msg === "no score") return fail("The AI's answer couldn't be used. Try again in a few minutes.", 502);
    return fail(`Couldn't score this lead: ${msg.slice(0, 160)}`, 502);
  }
});
