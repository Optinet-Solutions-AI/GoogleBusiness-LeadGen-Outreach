/**
 * assets.ts — brand asset storage: copy remote images into Supabase Storage + brand_assets rows.
 *
 * Inputs:  client id, remote image URL, origin/kind
 * Outputs: client-assets bucket objects + brand_assets rows; pure helpers (isCopyableImage, extFor, imageSize)
 * Used by: lib/clients/crawl/crawl-site.ts, crawl-social.ts
 */
import "@/lib/server-guard";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { fetchImageBuffer } from "@/lib/services/image-fetch";

const log = getLogger("client-assets");

export type AssetOrigin = "upload" | "website" | "facebook" | "instagram" | "google_maps" | "lead";

export type AssetRow = {
  id: string;
  client_id: string;
  product_id: string | null;
  kind: "logo" | "photo" | "video" | "document";
  origin: AssetOrigin;
  status: "pending" | "ready";
  storage_path: string | null;
  public_url: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  alt: string | null;
  tags: string[];
  source_url: string | null;
  created_at: string;
};

export const ASSETS_BUCKET = "client-assets";

/** Idempotent public bucket creation (errors when it already exists are ignored). */
export async function ensureAssetsBucket(db: SupabaseClient): Promise<void> {
  await db.storage.createBucket(ASSETS_BUCKET, { public: true }).catch(() => undefined);
}

export function isCopyableImage(input: {
  url: string;
  contentType: string | null;
  width: number | null;
  height: number | null;
  forLogo: boolean;
}): boolean {
  const { url, contentType, width, height, forLogo } = input;
  if (url.startsWith("data:")) return false;
  if (!contentType || !contentType.startsWith("image/")) return false;
  if (contentType === "image/gif") return false;
  if (contentType === "image/svg+xml") return forLogo;
  if (!forLogo && ((width ?? 0) < 200 || (height ?? 0) < 200)) return false;
  return true;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

export function extFor(contentType: string): string | null {
  return EXT[contentType] ?? null;
}

/** Read raster dimensions from PNG / JPEG / WebP headers; null for anything else (incl. SVG). */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 <= buf.length) {
      if (buf[o] !== 0xff) {
        o++;
        continue;
      }
      const m = buf[o + 1];
      if (m === 0xff) {
        o++;
        continue;
      }
      if (m === 0xc0 || m === 0xc2) {
        return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const t = buf.toString("ascii", 12, 16);
    if (t === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    if (t === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
    }
    if (t === "VP8 ") {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
  }
  return null;
}

/** Download a remote image into the client-assets bucket; dedupes on (client_id, source_url). */
export async function copyRemoteImage(input: {
  clientId: string;
  url: string;
  origin: AssetOrigin;
  kind: "logo" | "photo";
  alt?: string | null;
}): Promise<AssetRow | null> {
  const db = getDb();
  const { data: existing } = await db
    .from("brand_assets")
    .select("*")
    .eq("client_id", input.clientId)
    .eq("source_url", input.url)
    .limit(1)
    .maybeSingle();
  if (existing) return existing as AssetRow;

  const img = await fetchImageBuffer(input.url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 15_000 });
  if (!img) {
    log.warn({ url: input.url.slice(0, 80) }, "asset.skipped_fetch_failed_or_too_large");
    return null;
  }
  const size = imageSize(img.buffer);
  if (
    !isCopyableImage({
      url: input.url,
      contentType: img.contentType,
      width: size?.width ?? null,
      height: size?.height ?? null,
      forLogo: input.kind === "logo",
    })
  ) {
    return null;
  }
  const ext = extFor(img.contentType);
  if (!ext) return null;

  await ensureAssetsBucket(db);
  const id = randomUUID();
  const path = `${input.clientId}/${id}.${ext}`;
  const { error: upErr } = await db.storage
    .from(ASSETS_BUCKET)
    .upload(path, img.buffer, { contentType: img.contentType, upsert: true });
  if (upErr) {
    log.warn({ url: input.url.slice(0, 80), err: upErr.message }, "asset.upload_failed");
    return null;
  }
  const publicUrl = db.storage.from(ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
  const { data, error } = await db
    .from("brand_assets")
    .insert({
      id,
      client_id: input.clientId,
      kind: input.kind,
      origin: input.origin,
      status: "ready",
      storage_path: path,
      public_url: publicUrl,
      width: size?.width ?? null,
      height: size?.height ?? null,
      bytes: img.buffer.length,
      alt: input.alt ?? null,
      source_url: input.url,
    })
    .select("*")
    .single();
  if (error || !data) {
    log.warn({ err: error?.message }, "asset.insert_failed");
    await db.storage.from(ASSETS_BUCKET).remove([path]).catch(() => undefined);
    return null;
  }
  return data as AssetRow;
}

/** Remove the storage object and the row (brand_profiles references are tolerated, not rewritten). */
export async function deleteAsset(clientId: string, assetId: string): Promise<void> {
  const db = getDb();
  const { data } = await db
    .from("brand_assets")
    .select("storage_path")
    .eq("id", assetId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (data?.storage_path) {
    await db.storage
      .from(ASSETS_BUCKET)
      .remove([data.storage_path as string])
      .catch(() => undefined);
  }
  const { error } = await db.from("brand_assets").delete().eq("id", assetId).eq("client_id", clientId);
  if (error) throw new Error(`asset delete failed: ${error.message}`);
}
