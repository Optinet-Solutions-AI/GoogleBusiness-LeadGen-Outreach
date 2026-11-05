/**
 * api/ads/[id]/remake/route.ts — POST: make OUR version of a competitor ad for a client.
 *
 * Body: { client_id, platforms[] } → { creative_id, analysis, cost_usd } (one Gemini call, fractions of a cent;
 *       the post itself is a free draft until Generated in Creative Studio)
 * Used by: components/ads/AdLibrary.tsx
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { allUuids } from "@/lib/creatives/http-errors";
import { PlatformSchema } from "@/lib/creatives/types";
import { AdNotFoundError } from "@/lib/ads/library";
import { remakeAd, RemakeError } from "@/lib/ads/remake";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ client_id: z.string().uuid(), platforms: z.array(PlatformSchema).min(1) });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id)) return fail("ad not found", 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  try {
    return ok(await remakeAd({ adId: params.id, clientId: parsed.data.client_id, platforms: parsed.data.platforms }));
  } catch (err) {
    if (err instanceof AdNotFoundError) return fail("ad not found", 404);
    if (err instanceof RemakeError) return fail(err.message, 400);
    throw err;
  }
});
