/**
 * video/render-reel.ts — render one Reel with Remotion and store the MP4. Server-only (Cloud Run job; local dev with Chromium).
 *
 * Inputs:  reel id (creative_videos row): client, month, creative ids, settings
 * Outputs: MP4 in the client-assets bucket (<client>/reels/<id>.mp4), the row marked ready (or failed with last_error)
 * Used by: scripts/cloud-run-job.ts (MODE=reel REEL_ID=<id>), app/api/clients/[id]/reels (local fallback)
 *
 * How: bundle remotion/index.ts once per process (webpack → /tmp), select the "reel" composition with the plan's
 * props, render H.264 with Playwright's Chromium as the browser, upload, update the row. Free: no AI, no paid API.
 */
import "@/lib/server-guard";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { ASSETS_BUCKET, ensureAssetsBucket } from "@/lib/clients/assets";
import { listCreatives } from "@/lib/creatives/creatives";
import { planReel, reelStoragePath, type ReelBrand, type ReelSourceCreative } from "./reel-plan";
import { claimVideo, failVideo, finishVideo, getVideo, VideoBusyError, type VideoRow } from "./videos";

const log = getLogger("reel-render");

let bundlePromise: Promise<string> | null = null;

/** Bundle the Remotion project once per process; later renders reuse the serve URL. */
async function getServeUrl(): Promise<string> {
  if (bundlePromise) return bundlePromise;
  bundlePromise = (async () => {
    const { bundle } = await import("@remotion/bundler");
    const entryPoint = path.resolve(process.cwd(), "remotion", "index.ts");
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "reel-bundle-"));
    const started = Date.now();
    const url = await bundle({ entryPoint, outDir, onProgress: () => undefined });
    log.info({ ms: Date.now() - started, outDir }, "reel.bundled");
    return url;
  })();
  bundlePromise.catch(() => {
    bundlePromise = null;
  });
  return bundlePromise;
}

async function chromiumPath(): Promise<string | null> {
  try {
    const { chromium } = await import("playwright");
    const p = chromium.executablePath();
    await fs.access(p);
    return p;
  } catch {
    return null;
  }
}

async function loadBrand(clientId: string): Promise<Partial<ReelBrand> & { name: string }> {
  const db = getDb();
  const { data: client } = await db.from("clients").select("name,current_version").eq("id", clientId).maybeSingle();
  const out: Partial<ReelBrand> & { name: string } = { name: (client as { name?: string } | null)?.name ?? "" };
  const v = (client as { current_version?: number } | null)?.current_version;
  if (!v) return out;
  const { data: profile } = await db.from("brand_profiles").select("data").eq("client_id", clientId).eq("version", v).maybeSingle();
  const visuals = (profile as { data?: { visuals?: { logo_asset_id?: string | null; colors?: { primary?: string; text?: string; background?: string } } } } | null)?.data?.visuals;
  if (visuals?.colors?.primary) out.primary = visuals.colors.primary;
  if (visuals?.colors?.text) out.text = visuals.colors.text;
  if (visuals?.colors?.background) out.background = visuals.colors.background;
  if (visuals?.logo_asset_id) {
    const { data: logo } = await db.from("brand_assets").select("public_url").eq("id", visuals.logo_asset_id).maybeSingle();
    out.logo_url = (logo as { public_url?: string | null } | null)?.public_url ?? null;
  }
  return out;
}

export type ReelRunResult = { reel_id: string; status: "ready" | "failed"; duration_sec?: number; bytes?: number; error?: string };

export async function renderReel(clientId: string, reelId: string): Promise<ReelRunResult> {
  let row: VideoRow;
  try {
    row = await claimVideo(reelId);
  } catch (err) {
    if (err instanceof VideoBusyError) return { reel_id: reelId, status: "failed", error: err.message };
    throw err;
  }
  if (row.client_id !== clientId) {
    await failVideo(reelId, "client mismatch");
    return { reel_id: reelId, status: "failed", error: "client mismatch" };
  }
  const started = Date.now();
  let outFile: string | null = null;
  try {
    const month = row.month.slice(0, 7);
    const creatives = (await listCreatives(clientId, { month })) as unknown as ReelSourceCreative[];
    const brand = await loadBrand(clientId);
    const title = row.settings.title === undefined ? brand.name : row.settings.title;
    const plan = planReel(creatives, row.creative_ids, { ...row.settings, title }, brand);

    const browserExecutable = await chromiumPath();
    if (!browserExecutable) throw new Error("Chromium is not installed here — Reels render on the Cloud Run job");

    const serveUrl = await getServeUrl();
    const { renderMedia, selectComposition } = await import("@remotion/renderer");
    const composition = await selectComposition({ serveUrl, id: "reel", inputProps: plan.props, browserExecutable });
    outFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "reel-out-")), `${reelId}.mp4`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outFile,
      inputProps: plan.props,
      browserExecutable,
      chromiumOptions: { gl: "swangle" },
      onProgress: ({ progress }) => {
        if (Math.round(progress * 20) !== Math.round((progress - 0.01) * 20)) log.info({ reel_id: reelId, progress: Math.round(progress * 100) }, "reel.progress");
      },
    });

    const mp4 = await fs.readFile(outFile);
    const db = getDb();
    await ensureAssetsBucket(db);
    const storagePath = reelStoragePath(clientId, reelId);
    const { error: upErr } = await db.storage.from(ASSETS_BUCKET).upload(storagePath, mp4, { contentType: "video/mp4", upsert: true, cacheControl: "60" });
    if (upErr) throw new Error(`reel upload failed: ${upErr.message}`);
    const publicUrl = db.storage.from(ASSETS_BUCKET).getPublicUrl(storagePath).data.publicUrl;
    await finishVideo(reelId, { storage_path: storagePath, public_url: publicUrl, bytes: mp4.length, duration_sec: plan.durationSec });
    log.info({ reel_id: reelId, slides: plan.props.slides.length, duration_sec: plan.durationSec, bytes: mp4.length, ms: Date.now() - started }, "reel.done");
    return { reel_id: reelId, status: "ready", duration_sec: plan.durationSec, bytes: mp4.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ reel_id: reelId, err: message, ms: Date.now() - started }, "reel.failed");
    await failVideo(reelId, message);
    return { reel_id: reelId, status: "failed", error: message };
  } finally {
    if (outFile) await fs.rm(path.dirname(outFile), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Convenience for the job: look the client up from the row. */
export async function renderReelById(reelId: string): Promise<ReelRunResult> {
  const { data, error } = await getDb().from("creative_videos").select("client_id").eq("id", reelId).maybeSingle();
  if (error || !data) throw new Error(`reel ${reelId} not found`);
  return renderReel((data as { client_id: string }).client_id, reelId);
}

export { getVideo };
