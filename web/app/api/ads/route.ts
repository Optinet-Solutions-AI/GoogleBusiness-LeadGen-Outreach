/**
 * api/ads/route.ts — GET: the competitor ad library with filters.
 *
 * Query: media=video|image, saved=1, q=<text>, pull=<id>, client=<id>
 * Outputs: { ads: AdRow[] }
 * Used by: components/ads/AdLibrary.tsx (refresh after a pull / save)
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { listAds } from "@/lib/ads/library";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const p = new URL(req.url).searchParams;
  const media = p.get("media");
  const ads = await listAds({
    media: media === "video" || media === "image" ? media : undefined,
    saved: p.get("saved") === "1",
    q: p.get("q") ?? undefined,
    pull: p.get("pull") ?? undefined,
    client: p.get("client") ?? undefined,
  });
  return ok({ ads });
});
