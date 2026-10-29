/**
 * api/clients/[id]/assets/[aid]/complete/route.ts — POST: confirm the browser upload and mark the asset ready.
 *
 * Inputs:  params.id, params.aid; body { width?, height? } (browser-measured image size)
 * Outputs: the ready AssetRow (with public_url)
 * Used by: client detail page (Assets tab), after the PUT to the signed URL
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { UploadError, completeUpload } from "@/lib/clients/assets";
import { NotFoundError } from "@/lib/clients/profile";

const Body = z.object({
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  try {
    return ok(await completeUpload(params.id, params.aid, parsed.data));
  } catch (e) {
    if (e instanceof UploadError) return fail(e.message, e.status);
    if (e instanceof NotFoundError) return fail(e.message, 404);
    throw e;
  }
});
