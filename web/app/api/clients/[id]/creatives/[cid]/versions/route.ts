/**
 * api/clients/[id]/creatives/[cid]/versions/route.ts — POST: save an edit as a new draft version and re-render it.
 *
 * Inputs:  params.id, params.cid; body { inputs?: partial CreativeInputs, copy?: CreativeCopy, note? }
 * Outputs: 202 { version, grounding, status, runner }; 409 when the post is being rendered (nothing is written).
 *          Claims the creative FIRST, then runs grounding + caption limits and writes the version; if either
 *          throws, the prior status is restored. The render job runs with CLAIMED=1.
 * Used by: Creative Studio (post editor "Save edit")
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail } from "@/lib/response";
import {
  claimCreativeRendering,
  getCreative,
  newVersion,
  setCreativeStatus,
  setVersionAi,
} from "@/lib/creatives/creatives";
import { dispatchJob } from "@/lib/creatives/dispatch";
import { EditSchema, prepareEdit } from "@/lib/creatives/edit";
import { runCreative } from "@/lib/creatives/generate";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.cid)) return fail("creative not found", 404);
  try {
    const edit = EditSchema.parse(await req.json().catch(() => ({})));
    const before = await getCreative(params.id, params.cid);
    const restore = () => setCreativeStatus(params.id, params.cid, before.status, before.last_error);
    if (!(await claimCreativeRendering(params.id, params.cid))) {
      return fail("This post is being rendered; try again in a moment.", 409);
    }
    let version: { version: number; id: string };
    let grounding;
    try {
      const prepared = await prepareEdit(params.id, params.cid, edit);
      grounding = prepared.grounding;
      version = await newVersion(params.id, params.cid, prepared.patch, { grounding });
      // carry the Gemini citations forward so the next edit still grounds against them
      await setVersionAi(params.id, params.cid, version.version, { claims_used: prepared.claimsUsed });
    } catch (e) {
      await restore().catch(() => undefined);
      throw e;
    }
    return await dispatchJob(req, {
      vars: { MODE: "creative", CREATIVE_ID: params.cid, ACTION: "render", CLAIMED: "1" },
      status: "rendering",
      local: () => runCreative(params.cid, "render", { claimed: true }),
      release: restore,
      extra: { version, grounding },
    });
  } catch (e) {
    return mapCreativeError(e);
  }
});
