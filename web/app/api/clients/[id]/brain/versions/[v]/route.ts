/**
 * api/clients/[id]/brain/versions/[v]/route.ts — GET: one profile version's data (read-only view).
 *
 * Inputs:  params.id, params.v
 * Outputs: { version, data }
 * Used by: client detail page (version history "View")
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getVersion } from "@/lib/clients/profile";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const v = Number(params.v);
  if (!Number.isInteger(v) || v < 1) return fail("Invalid version", 400);
  const row = await getVersion(params.id, v);
  if (!row) return fail("version not found", 404);
  return ok({ version: row.version, data: row.data });
});
