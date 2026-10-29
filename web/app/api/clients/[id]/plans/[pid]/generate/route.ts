/**
 * api/clients/[id]/plans/[pid]/generate/route.ts — POST: generate every pending post of a plan (PAID).
 *
 * Inputs:  params.id, params.pid; body { confirmed_estimate_usd } (>= 90% of the remaining estimate)
 * Outputs: 202 { status: "generating", runner }; 400 stale estimate; 409 already generating.
 *          The route does NOT set the generating flag; the job claims it.
 * Used by: Creative Studio ("Generate posts" after the cost confirmation)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail } from "@/lib/response";
import { dispatchJob } from "@/lib/creatives/dispatch";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";
import { runPlan } from "@/lib/creatives/generate";
import { getPlan, isPlanGenerating } from "@/lib/creatives/plans";
import { remainingEstimateUsd } from "@/lib/creatives/plan-progress";

const Body = z.object({ confirmed_estimate_usd: z.number().min(0) });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.pid)) return fail("plan not found", 404);
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    const plan = await getPlan(params.id, params.pid);
    if (isPlanGenerating(plan)) return fail("A generation run is already in progress.", 409);
    if (plan.concepts.length === 0) return fail("Plan the concepts first.", 400);
    const remaining = await remainingEstimateUsd(params.id, plan);
    if (body.confirmed_estimate_usd < remaining * 0.9) {
      return fail("Estimate changed; refresh and confirm again.", 400);
    }
    return await dispatchJob(req, {
      vars: { MODE: "content-plan", PLAN_ID: params.pid, ACTION: "generate" },
      status: "generating",
      local: () => runPlan(params.pid, "generate"),
      extra: { id: params.pid },
    });
  } catch (e) {
    return mapCreativeError(e);
  }
});
