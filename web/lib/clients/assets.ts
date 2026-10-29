/**
 * assets.ts — brand asset storage: copy remote images into Supabase Storage + brand_assets rows.
 *
 * Inputs:  client id, remote image URL or operator upload request, origin/kind
 * Outputs: renderPath / excludeRenders helpers; storeRenderPng (creative renders as origin=render rows);
 *          client-assets bucket objects + brand_assets rows; pure helpers (isCopyableImage, extFor, imageSize,
 *          kindForContentType, checkUploadLimits); signed-upload issue/complete; logo selection (new profile version)
 * Used by: lib/clients/crawl/crawl-site.ts, crawl-social.ts, /api/clients/[id]/assets routes
 */
import "@/lib/server-guard";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { fetchImageBuffer } from "@/lib/services/image-fetch";
import { getClient } from "./clients";
import { getCurrentProfile, NotFoundError, saveProfileVersion } from "./profile";
import { EMPTY_PROFILE } from "./types";

const log = getLogger("client-assets");

export type AssetOrigin = "upload" | "website" | "facebook" | "instagram" | "google_maps" | "lead" | "render";

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
  /** Extra request headers for the download (the crawler token, for the client's own site only). */
  headers?: Record<string, string>;
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

  const img = await fetchImageBuffer(input.url, {
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 15_000,
    headers: input.headers,
  });
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

export const UPLOAD_LIMITS = { image: 15 * 1024 ** 2, video: 100 * 1024 ** 2, document: 20 * 1024 ** 2 };

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

const UPLOAD_KIND: Record<string, "photo" | "video" | "document"> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "video/mp4": "video",
  "video/quicktime": "video",
  "application/pdf": "document",
};

export function kindForContentType(ct: string): "photo" | "video" | "document" | null {
  return UPLOAD_KIND[ct] ?? null;
}

/** Error message when `bytes` is unacceptable for the kind, else null. */
export function checkUploadLimits(kind: AssetRow["kind"], bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return "File is empty";
  if (kind === "video") return bytes > UPLOAD_LIMITS.video ? "Videos must be 100 MB or smaller" : null;
  if (kind === "document") return bytes > UPLOAD_LIMITS.document ? "Documents must be 20 MB or smaller" : null;
  return bytes > UPLOAD_LIMITS.image ? "Images must be 15 MB or smaller" : null;
}

/** Validate, insert a pending brand_assets row, and mint a signed Storage upload URL (browser PUTs the file). */
export async function issueUpload(
  clientId: string,
  input: { filename: string; content_type: string; bytes: number; kind?: "logo" | "photo" },
): Promise<{ asset_id: string; path: string; signed_url: string; token: string }> {
  const derived = kindForContentType(input.content_type);
  if (!derived) throw new UploadError("Unsupported file type");
  if (input.kind === "logo" && derived !== "photo") throw new UploadError("A logo must be an image");
  const kind = input.kind ?? derived;
  const limitErr = checkUploadLimits(kind, input.bytes);
  if (limitErr) throw new UploadError(limitErr);
  const ext = extFor(input.content_type);
  if (!ext) throw new UploadError("Unsupported file type");
  if (!(await getClient(clientId))) throw new NotFoundError("client not found");

  const db = getDb();
  const id = randomUUID();
  const path = `${clientId}/${id}.${ext}`;
  const { error } = await db.from("brand_assets").insert({
    id,
    client_id: clientId,
    kind,
    origin: "upload",
    status: "pending",
    storage_path: path,
    bytes: input.bytes,
    alt: input.filename,
  });
  if (error) throw new Error(`asset insert failed: ${error.message}`);

  await ensureAssetsBucket(db);
  const { data, error: signErr } = await db.storage.from(ASSETS_BUCKET).createSignedUploadUrl(path);
  if (signErr || !data) {
    await db.from("brand_assets").delete().eq("id", id).eq("client_id", clientId);
    throw new Error(`signed upload url failed: ${signErr?.message ?? "no data"}`);
  }
  return { asset_id: id, path, signed_url: data.signedUrl, token: data.token };
}

async function getAssetRow(clientId: string, assetId: string): Promise<AssetRow> {
  const { data, error } = await getDb()
    .from("brand_assets")
    .select("*")
    .eq("id", assetId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`read asset failed: ${error.message}`);
  if (!data) throw new NotFoundError("asset not found");
  return data as AssetRow;
}

/** Confirm the browser's PUT landed, then flip the pending row to ready with its public URL. */
export async function completeUpload(
  clientId: string,
  assetId: string,
  input: { width?: number | null; height?: number | null },
): Promise<AssetRow> {
  const row = await getAssetRow(clientId, assetId);
  if (!row.storage_path) throw new UploadError("Upload not found; try again", 409);
  const db = getDb();
  const { data: signed, error: sErr } = await db.storage.from(ASSETS_BUCKET).createSignedUrl(row.storage_path, 60);
  if (sErr || !signed) throw new UploadError("Upload not found; try again", 409);
  const publicUrl = db.storage.from(ASSETS_BUCKET).getPublicUrl(row.storage_path).data.publicUrl;
  const { data, error } = await db
    .from("brand_assets")
    .update({
      public_url: publicUrl,
      width: input.width ?? null,
      height: input.height ?? null,
      status: "ready",
    })
    .eq("id", assetId)
    .eq("client_id", clientId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`complete upload failed: ${error?.message ?? "no row"}`);
  return data as AssetRow;
}

/** Drop Creative Studio renders/backgrounds so they never leak into Phase 1 (brand) readers. */
export function excludeRenders<T extends { origin: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.origin !== "render");
}

/** Storage path of a creative render: `<client>/creatives/<version>/<aspect-with-x>[-slide-N].png`. */
export function renderPath(clientId: string, versionId: string, aspect: string, slide: number | null): string {
  const a = aspect.replace(":", "x");
  return `${clientId}/creatives/${versionId}/${a}${slide == null ? "" : `-slide-${slide}`}.png`;
}

/** Upload a render PNG (upsert) and upsert its brand_assets row (origin 'render'), keyed by storage_path. */
export async function storeRenderPng(input: {
  clientId: string;
  versionId: string;
  aspect: string;
  slide: number | null;
  png: Buffer;
  tags: string[];
}): Promise<AssetRow> {
  const db = getDb();
  await ensureAssetsBucket(db);
  const path = renderPath(input.clientId, input.versionId, input.aspect, input.slide);
  const { error: upErr } = await db.storage
    .from(ASSETS_BUCKET)
    .upload(path, input.png, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(`render upload failed: ${upErr.message}`);
  const publicUrl = db.storage.from(ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
  const size = imageSize(input.png);
  const fields = {
    client_id: input.clientId,
    kind: "photo",
    origin: "render",
    status: "ready",
    storage_path: path,
    public_url: publicUrl,
    width: size?.width ?? null,
    height: size?.height ?? null,
    bytes: input.png.length,
    tags: input.tags,
  };
  const { data: existing } = await db
    .from("brand_assets")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("storage_path", path)
    .limit(1)
    .maybeSingle();
  const q = existing
    ? db.from("brand_assets").update(fields).eq("id", (existing as { id: string }).id)
    : db.from("brand_assets").insert({ id: randomUUID(), ...fields });
  const { data, error } = await q.select("*").single();
  if (error || !data) throw new Error(`render asset save failed: ${error?.message ?? "no row"}`);
  return data as AssetRow;
}

/** Ready assets for the client, newest first; creative renders are excluded unless `includeRenders`. */
export async function listAssets(clientId: string, opts?: { includeRenders?: boolean }): Promise<AssetRow[]> {
  let q = getDb().from("brand_assets").select("*").eq("client_id", clientId).eq("status", "ready");
  if (!opts?.includeRenders) q = q.neq("origin", "render");
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(`list assets failed: ${error.message}`);
  return (data ?? []) as AssetRow[];
}

/** Make a ready image asset the client's logo via a new operator profile version. */
export async function setLogo(clientId: string, assetId: string): Promise<void> {
  const row = await getAssetRow(clientId, assetId);
  if (row.status !== "ready") throw new UploadError("Asset is not ready");
  if (row.origin === "render") throw new UploadError("A creative render cannot be the logo");
  if (row.kind !== "photo" && row.kind !== "logo") throw new UploadError("A logo must be an image");
  const client = await getClient(clientId);
  if (!client) throw new NotFoundError("client not found");
  const current = await getCurrentProfile(clientId);
  const base = current?.data ?? EMPTY_PROFILE;
  // Version numbers are shared with drafts, so guard on the client's counter (see products.ts commitProductsVersion).
  await saveProfileVersion(
    clientId,
    { ...base, visuals: { ...base.visuals, logo_asset_id: assetId } },
    { writtenBy: "operator", state: "current", note: "logo", expectedVersion: client.current_version },
  );
  if (row.kind === "photo") {
    await getDb().from("brand_assets").update({ kind: "logo" }).eq("id", assetId).eq("client_id", clientId);
  }
}
