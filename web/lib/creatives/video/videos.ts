/**
 * video/videos.ts — creative_videos rows: create a Reel request, list a month's Reels, claim / finish / fail. Server-only.
 *
 * Inputs:  client id, month, creative ids + settings; reel id for state changes
 * Outputs: VideoRow(s); throws VideoNotFoundError / VideoBusyError
 * Used by: app/api/clients/[id]/reels/*, lib/creatives/video/render-reel.ts, the dashboard (types only)
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import type { ReelSettings } from "./reel-plan";

export type VideoStatus = "queued" | "rendering" | "ready" | "failed";

export type VideoRow = {
  id: string;
  client_id: string;
  month: string;
  creative_ids: string[];
  settings: ReelSettings;
  status: VideoStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_sec: number | null;
  storage_path: string | null;
  public_url: string | null;
  bytes: number | null;
  last_error: string | null;
  created_at: string;
};

export class VideoNotFoundError extends Error {}
export class VideoBusyError extends Error {}

/** A render older than this with no finish is treated as dead (Cloud Run job timeout + margin). */
export const RENDER_STALE_MS = 40 * 60_000;

export function isRenderLive(row: Pick<VideoRow, "status" | "started_at">, now = Date.now()): boolean {
  if (row.status !== "rendering" || !row.started_at) return false;
  return now - Date.parse(row.started_at) < RENDER_STALE_MS;
}

const COLS = "id,client_id,month,creative_ids,settings,status,started_at,finished_at,duration_sec,storage_path,public_url,bytes,last_error,created_at";

export async function createVideo(clientId: string, month: string, creativeIds: string[], settings: ReelSettings): Promise<VideoRow> {
  const { data, error } = await getDb()
    .from("creative_videos")
    .insert({ client_id: clientId, month: `${month.slice(0, 7)}-01`, creative_ids: creativeIds, settings, status: "queued" })
    .select(COLS)
    .single();
  if (error) throw new Error(`create reel failed: ${error.message}`);
  return data as VideoRow;
}

export async function listVideos(clientId: string, month: string): Promise<VideoRow[]> {
  const { data, error } = await getDb()
    .from("creative_videos")
    .select(COLS)
    .eq("client_id", clientId)
    .eq("month", `${month.slice(0, 7)}-01`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    if (/creative_videos/.test(error.message)) return []; // migration 055 not applied yet
    throw new Error(`list reels failed: ${error.message}`);
  }
  return (data ?? []) as VideoRow[];
}

export async function getVideo(clientId: string, id: string): Promise<VideoRow> {
  const { data, error } = await getDb().from("creative_videos").select(COLS).eq("client_id", clientId).eq("id", id).maybeSingle();
  if (error) throw new Error(`read reel failed: ${error.message}`);
  if (!data) throw new VideoNotFoundError("reel not found");
  return data as VideoRow;
}

/** Atomically move queued/stale → rendering. Throws VideoBusyError when a live render holds it. */
export async function claimVideo(id: string): Promise<VideoRow> {
  const stamp = new Date().toISOString();
  const stale = new Date(Date.now() - RENDER_STALE_MS).toISOString();
  const { data, error } = await getDb()
    .from("creative_videos")
    .update({ status: "rendering", started_at: stamp, finished_at: null, last_error: null })
    .eq("id", id)
    .or(`status.in.(queued,failed),and(status.eq.rendering,started_at.lt."${stale}")`)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`claim reel failed: ${error.message}`);
  if (!data) throw new VideoBusyError("reel is already rendering");
  return data as VideoRow;
}

export async function finishVideo(id: string, out: { storage_path: string; public_url: string; bytes: number; duration_sec: number }): Promise<void> {
  const { error } = await getDb()
    .from("creative_videos")
    .update({ status: "ready", finished_at: new Date().toISOString(), last_error: null, ...out })
    .eq("id", id);
  if (error) throw new Error(`finish reel failed: ${error.message}`);
}

export async function failVideo(id: string, message: string): Promise<void> {
  await getDb()
    .from("creative_videos")
    .update({ status: "failed", finished_at: new Date().toISOString(), last_error: message.slice(0, 500) })
    .eq("id", id);
}

export async function deleteVideo(clientId: string, id: string): Promise<void> {
  const row = await getVideo(clientId, id);
  const db = getDb();
  if (row.storage_path) await db.storage.from("client-assets").remove([row.storage_path]).catch(() => undefined);
  const { error } = await db.from("creative_videos").delete().eq("id", id).eq("client_id", clientId);
  if (error) throw new Error(`delete reel failed: ${error.message}`);
}
