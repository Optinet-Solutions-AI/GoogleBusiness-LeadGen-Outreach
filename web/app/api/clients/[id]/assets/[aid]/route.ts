/**
 * api/clients/[id]/assets/[aid]/route.ts — DELETE: remove an asset. PATCH { set_logo: true }: make it the logo.
 *
 * Inputs:  params.id, params.aid; PATCH body { set_logo: true }
 * Outputs: { deleted: true } or { logo_asset_id } (set_logo mints an operator profile version, note "logo")
 * Used by: client detail page (Assets tab)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { UploadError, deleteAsset, setLogo } from "@/lib/clients/assets";
import { NotFoundError, VersionConflictError } from "@/lib/clients/profile";

const Patch = z.object({ set_logo: z.literal(true) });

export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const { data } = await getDb()
    .from("brand_assets")
    .select("id")
    .eq("id", params.aid)
    .eq("client_id", params.id)
    .maybeSingle();
  if (!data) return fail("asset not found", 404);
  await deleteAsset(params.id, params.aid);
  return ok({ deleted: true });
});

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  try {
    await setLogo(params.id, params.aid);
    return ok({ logo_asset_id: params.aid });
  } catch (e) {
    if (e instanceof VersionConflictError) return fail(e.message, 409);
    if (e instanceof UploadError) return fail(e.message, e.status);
    if (e instanceof NotFoundError) return fail(e.message, 404);
    throw e;
  }
});
