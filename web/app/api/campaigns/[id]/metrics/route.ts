/**
 * api/campaigns/[id]/metrics/route.ts — GET campaign-scoped funnel/conversion/monitoring.
 *
 * Inputs:  campaign id (URL param)
 * Outputs: CampaignAnalytics scoped to the campaign's snapshot membership
 * Used by: Chunk 2b dashboard UI
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { loadCampaignAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const data = await loadCampaignAnalytics(params.id);
  return ok({ campaign_id: params.id, ...data });
});
