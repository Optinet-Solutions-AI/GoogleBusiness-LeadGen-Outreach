/**
 * api/clients/[id]/plans/[pid]/concepts/route.ts — POST: plan the month's post concepts (1 Gemini call).
 *
 * Inputs:  params.id, params.pid
 * Outputs: 202 { status: "planning", runner }; 409 when the plan is not planning/ready or is generating
 * Used by: Creative Studio ("Plan concepts")
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail } from "@/lib/response";
import { dispatchJob } from "@/lib/creatives/dispatch";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";
import { runPlan } from "@/lib/creatives/generate";
import { getPlan, isPlanGenerating, PlanStateError } from "@/lib/creatives/plans";

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.pid)) return fail("plan not found", 404);
  try {
    const plan = await getPlan(params.id, params.pid);
    if (plan.status !== "planning" && plan.status !== "ready") {
      throw new PlanStateError(`concepts can only be planned while planning or ready (plan is ${plan.status})`);
    }
    if (isPlanGenerating(plan)) throw new PlanStateError("A generation run is already in progress.");
    return await dispatchJob(req, {
      vars: { MODE: "content-plan", PLAN_ID: params.pid, ACTION: "concepts" },
      status: "planning",
      local: () => runPlan(params.pid, "concepts"),
      extra: { id: params.pid },
    });
  } catch (e) {
    return mapCreativeError(e);
  }
});
