/**
 * api/clients/[id]/plans/[pid]/route.ts — GET plan detail; PATCH concepts/cadence; DELETE (planning/ready only).
 *
 * Inputs:  params.id, params.pid; PATCH body { concepts?, posts_per_week?, platforms?, product_ids?, ai_backgrounds? }
 * Outputs: GET { plan, creatives, progress, remaining_count, remaining_estimate_usd, spent_usd, spent_by_creative };
 *          PATCH { plan }; DELETE { id }
 * Used by: Creative Studio (plan view)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getPlan, updatePlanCadence, updatePlanConcepts, deletePlan } from "@/lib/creatives/plans";
import { planDetail } from "@/lib/creatives/plan-progress";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";
import { ConceptSchema, PlatformSchema } from "@/lib/creatives/types";

const Patch = z.object({
  concepts: z.array(ConceptSchema).optional(),
  posts_per_week: z.number().int().min(1).max(7).optional(),
  platforms: z.array(PlatformSchema).min(1).optional(),
  product_ids: z.array(z.string().uuid()).optional(),
  ai_backgrounds: z.boolean().optional(),
});

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.pid)) return fail("plan not found", 404);
  try {
    return ok(await planDetail(params.id, await getPlan(params.id, params.pid)));
  } catch (e) {
    return mapCreativeError(e);
  }
});

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.pid)) return fail("plan not found", 404);
  try {
    const { concepts, ...cadence } = Patch.parse(await req.json().catch(() => ({})));
    if (concepts === undefined && Object.keys(cadence).length === 0) return fail("nothing to update", 400);
    let plan = await getPlan(params.id, params.pid);
    if (Object.keys(cadence).length) plan = { ...plan, ...(await updatePlanCadence(params.id, params.pid, cadence)) };
    if (concepts) plan = { ...plan, ...(await updatePlanConcepts(params.id, params.pid, concepts)) };
    return ok({ plan });
  } catch (e) {
    return mapCreativeError(e);
  }
});

export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.pid)) return fail("plan not found", 404);
  try {
    await deletePlan(params.id, params.pid);
    return ok({ id: params.pid });
  } catch (e) {
    return mapCreativeError(e);
  }
});
