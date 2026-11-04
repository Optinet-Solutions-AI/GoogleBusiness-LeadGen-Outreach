/**
 * api/clients/[id]/reels/[rid]/route.ts — one Reel: poll its status, or delete it (row + MP4).
 *
 * GET    → { reel: VideoRow }
 * DELETE → { deleted: true }
 * Used by: components/clients/ReelsStrip.tsx
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { allUuids } from "@/lib/creatives/http-errors";
import { deleteVideo, getVideo, VideoNotFoundError } from "@/lib/creatives/video/videos";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.rid)) return fail("reel not found", 404);
  try {
    return ok({ reel: await getVideo(params.id, params.rid) });
  } catch (err) {
    if (err instanceof VideoNotFoundError) return fail("reel not found", 404);
    throw err;
  }
});

export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id, params.rid)) return fail("reel not found", 404);
  try {
    await deleteVideo(params.id, params.rid);
    return ok({ deleted: true });
  } catch (err) {
    if (err instanceof VideoNotFoundError) return fail("reel not found", 404);
    throw err;
  }
});
