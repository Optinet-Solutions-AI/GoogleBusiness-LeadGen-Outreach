/**
 * api/clients/[id]/reels/route.ts — Reels (video) for a client's month.
 *
 * GET  ?month=YYYY-MM → { reels: VideoRow[], eligible: [{id,title,slot_date}] } (free)
 * POST { month, creative_ids[2..12], slide_sec?, fade_sec?, title? } → 202 { id, status: "queued", runner } (free: no AI)
 *      Validates the plan (every post has a 9:16 render) before queuing, then runs MODE=reel on Cloud Run.
 * Used by: components/clients/ReelsStrip.tsx
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { dispatchJob } from "@/lib/creatives/dispatch";
import { allUuids } from "@/lib/creatives/http-errors";
import { listCreatives } from "@/lib/creatives/creatives";
import { eligibleForReel, planReel, ReelPlanError, REEL_MAX_SLIDES, REEL_MIN_SLIDES, type ReelSourceCreative } from "@/lib/creatives/video/reel-plan";
import { createVideo, listVideos } from "@/lib/creatives/video/videos";
import { renderReel } from "@/lib/creatives/video/render-reel";

export const dynamic = "force-dynamic";

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const GET = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id)) return fail("client not found", 404);
  const month = MONTH.safeParse(new URL(req.url).searchParams.get("month"));
  if (!month.success) return fail("month must be YYYY-MM", 422);
  const [reels, creatives] = await Promise.all([listVideos(params.id, month.data), listCreatives(params.id, { month: month.data })]);
  const eligible = eligibleForReel(creatives as unknown as ReelSourceCreative[]).map((c) => ({ id: c.id, title: c.title, slot_date: c.slot_date }));
  return ok({ reels, eligible });
});

const Body = z.object({
  month: MONTH,
  creative_ids: z.array(z.string().uuid()).min(REEL_MIN_SLIDES).max(REEL_MAX_SLIDES),
  slide_sec: z.number().min(1.5).max(8).optional(),
  fade_sec: z.number().min(0).max(1.5).optional(),
  title: z.string().max(60).optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id)) return fail("client not found", 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  const { month, creative_ids, ...settings } = parsed.data;

  const creatives = (await listCreatives(params.id, { month })) as unknown as ReelSourceCreative[];
  try {
    planReel(creatives, creative_ids, settings); // same checks the job will make — fail fast, before a row exists
  } catch (err) {
    if (err instanceof ReelPlanError) return fail(err.message, 400);
    throw err;
  }
  const row = await createVideo(params.id, month, creative_ids, settings);
  return dispatchJob(req, {
    vars: { MODE: "reel", REEL_ID: row.id },
    status: "queued",
    local: () => renderReel(params.id, row.id),
    extra: { id: row.id },
  });
});
