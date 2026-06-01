/**
 * api/batches/[id]/metrics/route.ts — Campaign analytics for one batch.
 *
 * GET /api/batches/:id/metrics
 *   - Returns the voice+SMS funnel, conversion rates, call-outcome breakdown,
 *     monitoring counts, cost, and per-offer conversion for this batch.
 *
 * Read-only aggregation (no paid calls). Thin: validates config, calls
 * lib/analytics.loadAnalytics, returns the { success, data } envelope.
 */

import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { loadAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const data = await loadAnalytics(params.id);
  return ok({ batch_id: params.id, ...data });
});
