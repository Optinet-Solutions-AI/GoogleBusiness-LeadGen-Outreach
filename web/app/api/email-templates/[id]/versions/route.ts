/**
 * api/email-templates/[id]/versions/route.ts — every saved version of one template, newest first.
 *
 * Inputs:  GET
 * Outputs: { success, data: TemplateVersion[] }
 * Used by: the Templates page (History)
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { listVersions } from "@/lib/email/template-library";
import { fail, ok } from "@/lib/response";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  return ok(await listVersions(params.id));
});
