/**
 * api/clients/[id]/creatives/[cid]/regenerate/route.ts — POST: redo copy (paid), render (free) or background (paid).
 *
 * Inputs:  params.id, params.cid; body { what: "copy" | "render" | "background" } (explicit; the UI confirms spend)
 * Outputs: 202 { status: "rendering", runner }; 409 when the post is already being rendered.
 *          The route claims the creative (claimCreativeRendering); the job runs with CLAIMED=1.
 * Used by: Creative Studio (regenerate menu)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail } from "@/lib/response";
import { claimCreativeRendering, getCreative, setCreativeStatus } from "@/lib/creatives/creatives";
import { dispatchJob } from "@/lib/creatives/dispatch";
import { runCreative } from "@/lib/creatives/generate";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";

const Body = z.object({ what: z.enum(["copy", "render", "background"]) });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.cid)) return fail("creative not found", 404);
  try {
    const { what } = Body.parse(await req.json().catch(() => ({})));
    const before = await getCreative(params.id, params.cid);
    if (!(await claimCreativeRendering(params.id, params.cid))) {
      return fail("This post is being rendered; try again in a moment.", 409);
    }
    return await dispatchJob(req, {
      vars: { MODE: "creative", CREATIVE_ID: params.cid, ACTION: what, CLAIMED: "1" },
      status: "rendering",
      local: () => runCreative(params.cid, what, { claimed: true }),
      release: () => setCreativeStatus(params.id, params.cid, before.status, before.last_error),
      extra: { id: params.cid },
    });
  } catch (e) {
    return mapCreativeError(e);
  }
});
