/**
 * api/ads/[id]/route.ts — one competitor ad: save / tag / note, or delete.
 *
 * PATCH  { saved?, tags?, notes?, client_id? } → { ad } (saving copies the video + images into our Storage)
 * DELETE → { deleted: true }
 * Used by: components/ads/AdLibrary.tsx
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { allUuids } from "@/lib/creatives/http-errors";
import { normaliseTags } from "@/lib/crm/board";
import { AdNotFoundError, deleteAd, updateAd } from "@/lib/ads/library";

export const dynamic = "force-dynamic";

const Body = z.object({
  saved: z.boolean().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  notes: z.string().max(4000).nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
});

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id)) return fail("ad not found", 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  const patch = { ...parsed.data, ...(parsed.data.tags ? { tags: normaliseTags(parsed.data.tags) } : {}) };
  try {
    return ok({ ad: await updateAd(params.id, patch) });
  } catch (err) {
    if (err instanceof AdNotFoundError) return fail("ad not found", 404);
    throw err;
  }
});

export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id)) return fail("ad not found", 404);
  await deleteAd(params.id);
  return ok({ deleted: true });
});
