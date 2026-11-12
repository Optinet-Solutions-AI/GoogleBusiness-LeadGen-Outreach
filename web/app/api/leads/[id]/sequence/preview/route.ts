/**
 * api/leads/[id]/sequence/preview/route.ts — what the Send email button would send, before it sends anything.
 *
 * Inputs:  GET, lead id
 * Outputs: EmailPreview (to/from, timing, pitch, language, each step's exact wording, can-send + reason)
 * Used by: components/outreach/EmailPreviewModal.tsx
 */
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { loadEmailPreview } from "@/lib/email/load-email-preview";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const preview = await loadEmailPreview(params.id);
  return preview ? ok(preview) : fail("Lead not found", 404);
});
