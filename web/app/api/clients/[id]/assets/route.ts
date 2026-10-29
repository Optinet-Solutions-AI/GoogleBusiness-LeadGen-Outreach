/**
 * api/clients/[id]/assets/route.ts — POST: start an asset upload (validates, returns a signed Storage URL).
 *
 * Inputs:  params.id; body { filename, content_type, bytes, kind? }
 * Outputs: { asset_id, path, signed_url, token } and a pending brand_assets row
 * Used by: client detail page (Assets tab). Browser contract (files bypass the ~4.5 MB route body cap):
 *          1. POST here  2. fetch(signed_url, { method: "PUT", headers: { "content-type": file.type }, body: file })
 *          3. POST /api/clients/:id/assets/:aid/complete
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { UploadError, issueUpload } from "@/lib/clients/assets";
import { NotFoundError } from "@/lib/clients/profile";

const Body = z.object({
  filename: z.string().min(1).max(300),
  content_type: z.string().min(1).max(100),
  bytes: z.number().int().positive(),
  kind: z.enum(["logo", "photo"]).optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid upload request", 400);
  try {
    return ok(await issueUpload(params.id, parsed.data));
  } catch (e) {
    if (e instanceof UploadError) return fail(e.message, e.status);
    if (e instanceof NotFoundError) return fail(e.message, 404);
    throw e;
  }
});
