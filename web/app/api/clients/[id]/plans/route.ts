/**
 * api/clients/[id]/plans/route.ts — GET: list month plans. POST: create a plan and return its cost estimate.
 *
 * Inputs:  params.id; POST body { month "YYYY-MM", platforms, posts_per_week, product_ids?, ai_backgrounds }
 * Outputs: GET { plans } with remaining_estimate_usd each; POST 201 { plan } (plan.estimate_usd)
 * Used by: Creative Studio (plans tab)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getClient } from "@/lib/clients/clients";
import { createPlan, listPlans } from "@/lib/creatives/plans";
import { remainingEstimateUsd } from "@/lib/creatives/plan-progress";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";
import { PlatformSchema } from "@/lib/creatives/types";

const Body = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM"),
  platforms: z.array(PlatformSchema).min(1),
  posts_per_week: z.number().int().min(1).max(7),
  product_ids: z.array(z.string().uuid()).optional(),
  ai_backgrounds: z.boolean(),
});

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id)) return fail("client not found", 404);
  try {
    const plans = await listPlans(params.id);
    return ok({
      plans: await Promise.all(
        plans.map(async (p) => ({ ...p, remaining_estimate_usd: await remainingEstimateUsd(params.id, p) })),
      ),
    });
  } catch (e) {
    return mapCreativeError(e);
  }
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id) || !(await getClient(params.id))) return fail("client not found", 404);
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    return ok({ plan: await createPlan(params.id, body) }, { status: 201 });
  } catch (e) {
    return mapCreativeError(e);
  }
});
