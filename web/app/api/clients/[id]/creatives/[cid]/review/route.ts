/**
 * api/clients/[id]/creatives/[cid]/review/route.ts — POST: approve / reject / request changes on the latest draft.
 *
 * Inputs:  params.id, params.cid; body { action, note? }
 * Outputs: { version }; 422 with the reason when the version cannot be approved / is not a draft;
 *          409 on approve while the creative is `rendering`
 * Used by: Creative Studio (review buttons)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getCreative, reviewVersion } from "@/lib/creatives/creatives";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";

const Body = z.object({
  action: z.enum(["approve", "reject", "request_changes"]),
  note: z.string().optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.cid)) return fail("creative not found", 404);
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    const creative = await getCreative(params.id, params.cid);
    const latest = creative.versions[0]; // newest first
    if (!latest) return fail("This post has no version to review yet.", 422);
    // Ruling 34: never approve mid-render (the draft's copy may already be newer than its images)
    if (body.action === "approve" && creative.status === "rendering") {
      return fail("This post is being rendered; approve it once the render finishes.", 409);
    }
    return ok({ version: await reviewVersion(params.id, params.cid, latest.version, body.action, body.note) });
  } catch (e) {
    return mapCreativeError(e);
  }
});
