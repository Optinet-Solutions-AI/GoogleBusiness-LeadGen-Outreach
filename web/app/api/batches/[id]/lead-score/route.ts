/**
 * api/batches/[id]/lead-score/route.ts — "Score this batch": how many leads have no score, and start scoring them.
 *
 * Inputs:  GET params.id · POST params.id + { confirm: true }
 * Outputs: GET  { unscored, cap, est_usd } (free: what the button shows before you confirm)
 *          POST { started: true } (202) — starts Cloud Run MODE=lead-score BATCH_ID; 409 when every lead already has a
 *               score, 503 when Cloud Run or migration 076 is missing
 * Used by: components/batches/ScoreBatchButton.tsx
 *
 * Thin: lib/leads/lead-score-batch.ts (run on Cloud Run). Paid: about half a cent a lead, up to
 * LEAD_SCORE_MAX_PER_BATCH. workflows/score_leads.md.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { isDbConfigured } from "@/lib/safe-db";
import { LEAD_SCORE_USD_PER_LEAD } from "@/lib/pricing";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";
import { claimBatchScoring, releaseBatchScoring, unscoredCount } from "@/lib/leads/lead-score-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("api.batches.lead-score");
const MISSING_076 = "Run database update 076 first (lead score).";
const Body = z.object({ confirm: z.literal(true) });

async function count(batchId: string): Promise<{ unscored: number; cap: number; est_usd: number } | { error: string }> {
  try {
    const unscored = await unscoredCount(batchId);
    const cap = env.LEAD_SCORE_MAX_PER_BATCH;
    return { unscored, cap, est_usd: Math.round(Math.min(unscored, cap) * LEAD_SCORE_USD_PER_LEAD * 100) / 100 };
  } catch (err) {
    return { error: /lead_score/.test(String(err)) ? MISSING_076 : String(err).slice(0, 160) };
  }
}

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing batch id", 400);
  const c = await count(params.id);
  return "error" in c ? fail(c.error, 503) : ok(c);
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing batch id", 400);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Confirm the cost first.", 400);
  if (!isCloudRunConfigured()) return fail("Scoring a batch needs the Cloud Run worker (not available locally).", 503);
  if (env.LEAD_SCORE_MAX_PER_BATCH === 0) return fail("Lead scoring is switched off (LEAD_SCORE_MAX_PER_BATCH=0).", 409);
  const c = await count(params.id);
  if ("error" in c) return fail(c.error, 503);
  if (!c.unscored) return fail("Every lead in this batch already has a score.", 409);
  const claim = await claimBatchScoring(params.id);
  if (!claim.ok) return fail("Scoring this batch has already started (or couldn't be checked). Refresh in a few minutes.", 409);
  const oidcToken = req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
  try {
    await triggerJob({ MODE: "lead-score", BATCH_ID: params.id }, { oidcToken, timeoutSeconds: 1200 });
  } catch (err) {
    log.error({ batch_id: params.id, err: String(err) }, "lead_score.trigger_failed");
    await releaseBatchScoring(params.id).catch(() => undefined); // it didn't start: the button works again at once
    return fail("Couldn't start the scoring. Try again.", 502);
  }
  return ok({ started: true }, { status: 202 });
});
