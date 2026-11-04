/**
 * api/leads/[id]/timeline/route.ts — GET: one merged history for the CRM side panel.
 *
 * Inputs:  lead id
 * Outputs: { success, data: TimelineItem[] } newest first
 * Used by: components/crm/CrmLeadPanel.tsx
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { loadTimeline } from "@/lib/crm/timeline-load";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  return ok(await loadTimeline(params.id));
});
