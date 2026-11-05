/**
 * ads/pulls.ts — ad_pulls rows: create a pull request, list them, and run one (Apify → competitor_ads upserts).
 *
 * Inputs:  pull input (URL or keyword + country, media type, active-only, limit, optional client)
 * Outputs: PullRow(s); runPull writes competitor_ads (upsert by Meta ad id, keeping saved/tags/notes) + copies each
 *          thumbnail into Storage so cards keep working after Meta's CDN links expire
 * Used by: app/api/ads/pulls/route.ts, scripts/cloud-run-job.ts (MODE=ad-pull)
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { adLibrarySearchUrl, isMetaUrl, pullCostUsd, pullMetaAds, type AdMediaType, type MetaAd } from "@/lib/services/apify-ads";
import { storeAdMedia } from "./media";

const log = getLogger("ad-pulls");

export type PullStatus = "queued" | "running" | "done" | "failed";
export type PullRow = {
  id: string;
  source: string;
  source_url: string | null;
  query: string | null;
  country: string | null;
  media_type: AdMediaType;
  active_only: boolean;
  max_results: number;
  client_id: string | null;
  status: PullStatus;
  found: number;
  cost_usd: number | null;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export class PullInputError extends Error {}

export type PullInput = {
  source_url?: string | null;
  query?: string | null;
  country?: string | null;
  media_type?: AdMediaType;
  active_only?: boolean;
  max_results?: number;
  client_id?: string | null;
};

/** The Ad Library URL a pull starts from. Pure. */
export function startUrlFor(p: Pick<PullRow, "source_url" | "query" | "country" | "media_type" | "active_only">): string {
  if (p.source_url) {
    if (!isMetaUrl(p.source_url)) throw new PullInputError("the URL must be a facebook.com Ad Library or page link");
    return p.source_url;
  }
  if (!p.query?.trim()) throw new PullInputError("give an Ad Library URL or a keyword");
  return adLibrarySearchUrl(p.query, p.country ?? "us", p.media_type, p.active_only);
}

export async function createPull(input: PullInput): Promise<PullRow> {
  const row = {
    source: "meta",
    source_url: input.source_url?.trim() || null,
    query: input.query?.trim() || null,
    country: (input.country ?? "us").toLowerCase(),
    media_type: input.media_type ?? "all",
    active_only: input.active_only ?? true,
    max_results: input.max_results ?? 50,
    client_id: input.client_id ?? null,
    status: "queued" as const,
  };
  startUrlFor(row); // validate before inserting
  const { data, error } = await getDb().from("ad_pulls").insert(row).select("*").single();
  if (error) throw new Error(`create pull failed: ${error.message}`);
  return data as PullRow;
}

export async function listPulls(limit = 20): Promise<PullRow[]> {
  const { data, error } = await getDb().from("ad_pulls").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) {
    if (/ad_pulls/.test(error.message)) return []; // migration 056 not applied
    throw new Error(`list pulls failed: ${error.message}`);
  }
  return (data ?? []) as PullRow[];
}

export const PULL_STALE_MS = 20 * 60_000;

/** True while a run holds the pull (a stale `running` is treated as dead). */
export function isPullLive(p: Pick<PullRow, "status" | "started_at">, now = Date.now()): boolean {
  if (p.status === "queued") return true;
  if (p.status !== "running" || !p.started_at) return false;
  return now - Date.parse(p.started_at) < PULL_STALE_MS;
}

/** Upsert one ad. Existing rows keep saved / tags / notes / analysis / stored copies; fresh CDN links replace stale ones. */
async function upsertAd(pullId: string, clientId: string | null, ad: MetaAd, thumb: string | null): Promise<void> {
  const db = getDb();
  const { raw, ...fields } = ad;
  const { data: existing } = await db.from("competitor_ads").select("id,stored_thumbnail_url").eq("source", "meta").eq("source_ad_id", ad.source_ad_id).maybeSingle();
  const base = { ...fields, raw, pull_id: pullId, updated_at: new Date().toISOString() };
  if (existing) {
    const { error } = await db
      .from("competitor_ads")
      .update({ ...base, stored_thumbnail_url: (existing as { stored_thumbnail_url: string | null }).stored_thumbnail_url ?? thumb })
      .eq("id", (existing as { id: string }).id);
    if (error) throw new Error(`update ad failed: ${error.message}`);
    return;
  }
  const { error } = await db.from("competitor_ads").insert({ ...base, source: "meta", client_id: clientId, stored_thumbnail_url: thumb });
  if (error) throw new Error(`insert ad failed: ${error.message}`);
}

export type PullResult = { pull_id: string; status: "done" | "failed"; found: number; cost_usd: number; error?: string };

export async function runPull(pullId: string): Promise<PullResult> {
  const db = getDb();
  const { data: claimed, error: cErr } = await db
    .from("ad_pulls")
    .update({ status: "running", started_at: new Date().toISOString(), last_error: null })
    .eq("id", pullId)
    .in("status", ["queued", "failed", "running"])
    .select("*")
    .maybeSingle();
  if (cErr) throw new Error(`claim pull failed: ${cErr.message}`);
  if (!claimed) throw new Error(`pull ${pullId} not found`);
  const pull = claimed as PullRow;
  const started = Date.now();
  try {
    const startUrl = startUrlFor(pull);
    const ads = await pullMetaAds({ startUrl, limit: pull.max_results, activeOnly: pull.active_only });
    const wanted = pull.media_type === "all" ? ads : ads.filter((a) => (pull.media_type === "video" ? a.media_kind === "video" : a.media_kind !== "video"));
    let stored = 0;
    for (const ad of wanted) {
      let thumb: string | null = null;
      if (ad.thumbnail_url) {
        thumb = await storeAdMedia(ad.source_ad_id, "thumb", ad.thumbnail_url).catch(() => null);
        if (thumb) stored += 1;
      }
      await upsertAd(pull.id, pull.client_id, ad, thumb);
    }
    const cost = pullCostUsd(ads.length);
    await db.from("ad_pulls").update({ status: "done", found: wanted.length, cost_usd: cost, finished_at: new Date().toISOString() }).eq("id", pull.id);
    log.info({ pull_id: pull.id, fetched: ads.length, kept: wanted.length, thumbs: stored, cost_usd: cost, ms: Date.now() - started }, "ad_pull.done");
    return { pull_id: pull.id, status: "done", found: wanted.length, cost_usd: cost };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("ad_pulls").update({ status: "failed", last_error: message.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", pull.id);
    log.error({ pull_id: pull.id, err: message, ms: Date.now() - started }, "ad_pull.failed");
    return { pull_id: pull.id, status: "failed", found: 0, cost_usd: 0, error: message };
  }
}
