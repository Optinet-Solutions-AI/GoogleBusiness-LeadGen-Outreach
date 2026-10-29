/**
 * api/clients/[id]/creatives/[cid]/route.ts — GET a post with its versions and reviews; DELETE it.
 *
 * Inputs:  params.id, params.cid
 * Outputs: GET { creative (+ versions, reviews) }; DELETE { id }
 * Used by: Creative Studio (post editor)
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { deleteCreative, getCreative } from "@/lib/creatives/creatives";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.cid)) return fail("creative not found", 404);
  try {
    return ok({ creative: await getCreative(params.id, params.cid) });
  } catch (e) {
    return mapCreativeError(e);
  }
});

export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.cid)) return fail("creative not found", 404);
  try {
    await deleteCreative(params.id, params.cid);
    return ok({ id: params.cid });
  } catch (e) {
    return mapCreativeError(e);
  }
});
