/**
 * ads/library.ts — competitor_ads rows: list with filters, get one, save (copies media), tags / notes, delete.
 *
 * Inputs:  filters (media, saved, q, pull, client), ad id + patch
 * Outputs: AdRow(s); throws AdNotFoundError
 * Used by: app/(dashboard)/ads/page.tsx, app/api/ads/*, lib/ads/remake.ts
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import type { AdMediaKind } from "@/lib/services/apify-ads";
import type { AdAnalysis } from "@/lib/services/gemini-ads";
import { storeAdMedia } from "./media";

const log = getLogger("ad-library");

export type AdRemake = { client_id: string; creative_id: string; at: string };

export type AdRow = {
  id: string;
  pull_id: string | null;
  client_id: string | null;
  source: string;
  source_ad_id: string;
  page_id: string | null;
  page_name: string | null;
  page_url: string | null;
  page_category: string | null;
  ad_library_url: string | null;
  title: string | null;
  body: string | null;
  link_url: string | null;
  link_description: string | null;
  cta_text: string | null;
  display_format: string | null;
  media_kind: AdMediaKind;
  image_urls: string[];
  video_url: string | null;
  thumbnail_url: string | null;
  stored_thumbnail_url: string | null;
  stored_image_urls: string[];
  stored_video_url: string | null;
  platforms: string[];
  started_at: string | null;
  ended_at: string | null;
  is_active: boolean | null;
  saved: boolean;
  tags: string[];
  notes: string | null;
  analysis: AdAnalysis | null;
  remakes: AdRemake[];
  created_at: string;
  updated_at: string;
};

/** Everything but `raw` (the actor item can be large). */
const COLS =
  "id,pull_id,client_id,source,source_ad_id,page_id,page_name,page_url,page_category,ad_library_url,title,body,link_url,link_description,cta_text,display_format," +
  "media_kind,image_urls,video_url,thumbnail_url,stored_thumbnail_url,stored_image_urls,stored_video_url,platforms,started_at,ended_at,is_active,saved,tags,notes,analysis,remakes,created_at,updated_at";

export class AdNotFoundError extends Error {}

export type AdFilters = { media?: "video" | "image"; saved?: boolean; q?: string; pull?: string; client?: string; limit?: number };

export async function listAds(f: AdFilters = {}): Promise<AdRow[]> {
  let q = getDb().from("competitor_ads").select(COLS).order("saved", { ascending: false }).order("created_at", { ascending: false }).limit(f.limit ?? 300);
  if (f.media === "video") q = q.eq("media_kind", "video");
  if (f.media === "image") q = q.in("media_kind", ["image", "carousel"]);
  if (f.saved) q = q.eq("saved", true);
  if (f.pull) q = q.eq("pull_id", f.pull);
  if (f.client) q = q.eq("client_id", f.client);
  if (f.q?.trim()) {
    const term = f.q.trim().replace(/[%,()]/g, " ");
    q = q.or(`page_name.ilike.%${term}%,title.ilike.%${term}%,body.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) {
    if (/competitor_ads/.test(error.message)) return []; // migration 056 not applied
    throw new Error(`list ads failed: ${error.message}`);
  }
  return (data ?? []) as unknown as AdRow[];
}

export async function getAd(id: string): Promise<AdRow> {
  const { data, error } = await getDb().from("competitor_ads").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`read ad failed: ${error.message}`);
  if (!data) throw new AdNotFoundError("ad not found");
  return data as unknown as AdRow;
}

export async function updateAd(id: string, patch: { saved?: boolean; tags?: string[]; notes?: string | null; client_id?: string | null }): Promise<AdRow> {
  const ad = await getAd(id);
  const fields: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  // Saving copies the media we still can: Meta's CDN links expire, our Storage copies do not.
  if (patch.saved && !ad.saved) {
    if (ad.video_url && !ad.stored_video_url) {
      fields.stored_video_url = await storeAdMedia(ad.source_ad_id, "video", ad.video_url).catch((e) => {
        log.warn({ ad_id: id, err: String(e) }, "ad.save.video_copy_failed");
        return null;
      });
    }
    if (ad.image_urls.length && !ad.stored_image_urls.length) {
      const copies: string[] = [];
      for (const [i, u] of ad.image_urls.slice(0, 10).entries()) {
        const c = await storeAdMedia(ad.source_ad_id, "image", u, i).catch(() => null);
        if (c) copies.push(c);
      }
      fields.stored_image_urls = copies;
    }
  }
  const { data, error } = await getDb().from("competitor_ads").update(fields).eq("id", id).select(COLS).single();
  if (error) throw new Error(`update ad failed: ${error.message}`);
  return data as unknown as AdRow;
}

export async function deleteAd(id: string): Promise<void> {
  const { error } = await getDb().from("competitor_ads").delete().eq("id", id);
  if (error) throw new Error(`delete ad failed: ${error.message}`);
}

export async function recordRemake(id: string, analysis: AdAnalysis, remake: AdRemake): Promise<void> {
  const ad = await getAd(id);
  const { error } = await getDb()
    .from("competitor_ads")
    .update({ analysis, remakes: [...ad.remakes, remake], updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`record remake failed: ${error.message}`);
}
