/**
 * api/leads/[id]/call/preview/route.ts — what the AI agent will know before "Call with AI" queues a lead.
 *
 * Inputs:  GET, lead id. Asks Voizo GET /status (free, places no call).
 * Outputs: CallPreview (number dialled, greeting name, script, hours, queue, retries, can-call + reason)
 * Used by: components/outreach/CallPreviewModal.tsx
 */
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { loadCallPreview } from "@/lib/calls/load-call-preview";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const preview = await loadCallPreview(params.id);
  return preview ? ok(preview) : fail("Lead not found", 404);
});
