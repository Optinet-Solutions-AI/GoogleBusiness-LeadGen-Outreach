/**
 * api/clients/[id]/brain/versions/[v]/restore/route.ts — POST: restore an old version as a new one.
 *
 * Inputs:  params.id, params.v
 * Outputs: { version } (the newly created version)
 * Used by: client detail page (version history)
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getClient } from "@/lib/clients/clients";
import { NotFoundError, restoreVersion, VersionConflictError } from "@/lib/clients/profile";

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const v = Number(params.v);
  if (!Number.isInteger(v) || v < 1) return fail("Invalid version", 400);
  if (!(await getClient(params.id))) return fail("client not found", 404);
  try {
    return ok(await restoreVersion(params.id, v));
  } catch (e) {
    if (e instanceof NotFoundError) return fail(e.message, 404);
    if (e instanceof VersionConflictError) return fail(e.message, 409);
    throw e;
  }
});
