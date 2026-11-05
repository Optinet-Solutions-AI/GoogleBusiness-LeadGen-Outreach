/**
 * ads/media.ts — copy a competitor ad's media (thumbnail, images, video) from Meta's CDN into our Storage.
 *
 * Inputs:  Meta ad id, kind, the CDN URL
 * Outputs: our public URL in the client-assets bucket under competitors/<ad id>/…, or throws
 * Used by: lib/ads/pulls.ts (thumbnails at pull time), lib/ads/library.ts (images + video on Save)
 *
 * Meta's CDN links expire after days; copies are what keep the library browsable. Video capped at 200 MB.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { ASSETS_BUCKET, ensureAssetsBucket } from "@/lib/clients/assets";

const MAX_BYTES: Record<"thumb" | "image" | "video", number> = { thumb: 5 * 1024 ** 2, image: 15 * 1024 ** 2, video: 200 * 1024 ** 2 };

function extFor(contentType: string, kind: "thumb" | "image" | "video"): string {
  if (/mp4/.test(contentType)) return "mp4";
  if (/webm/.test(contentType)) return "webm";
  if (/png/.test(contentType)) return "png";
  if (/webp/.test(contentType)) return "webp";
  if (/gif/.test(contentType)) return "gif";
  return kind === "video" ? "mp4" : "jpg";
}

export async function storeAdMedia(adId: string, kind: "thumb" | "image" | "video", url: string, index = 0): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(kind === "video" ? 120_000 : 20_000), headers: { "User-Agent": "Mozilla/5.0 (RateUp ad library)" } });
  if (!res.ok) throw new Error(`fetch ${kind} failed: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? (kind === "video" ? "video/mp4" : "image/jpeg");
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error(`${kind} is empty`);
  if (buf.length > MAX_BYTES[kind]) throw new Error(`${kind} too large (${Math.round(buf.length / 1024 ** 2)} MB)`);
  const db = getDb();
  await ensureAssetsBucket(db);
  const path = `competitors/${adId}/${kind}${index ? `-${index}` : ""}.${extFor(contentType, kind)}`;
  const { error } = await db.storage.from(ASSETS_BUCKET).upload(path, buf, { contentType: contentType.split(";")[0], upsert: true, cacheControl: "86400" });
  if (error) throw new Error(`upload ${kind} failed: ${error.message}`);
  return db.storage.from(ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
}
