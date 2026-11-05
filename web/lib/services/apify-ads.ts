/**
 * apify-ads.ts — Meta Ad Library puller (Apify actor `apify/facebook-ads-scraper`) + its normaliser.
 *
 * Inputs:  an Ad Library URL (brand page or search) or a keyword + country; media type; active-only; limit
 * Outputs: MetaAd[] — one per ad: page, text, CTA, link, video / image URLs (Meta CDN, expire), platforms, dates
 * Used by: lib/ads/pulls.ts (runPull on the Cloud Run job). Pure helpers (normalizeMetaAd, adLibrarySearchUrl,
 *          pullCostUsd) are unit-tested.
 *
 * Paid: pay-per-result, APIFY_ADS_USD_PER_AD each (≈ $0.006). Runs async (start → poll → dataset) like apify.ts.
 */
import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("apify-ads");
const BASE_URL = "https://api.apify.com/v2";
const ACTOR = "apify~facebook-ads-scraper";
const POLL_INTERVAL_MS = 5000;
const RUN_DEADLINE_MS = 6 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clean = (s?: unknown): string | null => {
  const t = typeof s === "string" ? s.trim() : "";
  return t === "" ? null : t;
};

export type AdMediaType = "all" | "video" | "image";
export type AdMediaKind = "video" | "image" | "carousel" | "unknown";

export interface MetaAd {
  source_ad_id: string;
  page_id: string | null;
  page_name: string | null;
  page_url: string | null;
  page_category: string | null;
  ad_library_url: string;
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
  platforms: string[];
  started_at: string | null;
  ended_at: string | null;
  is_active: boolean | null;
  raw: Record<string, unknown>;
}

/** The actor's dataset item (only the fields we read). */
export interface ApifyAdItem {
  adArchiveID?: string;
  adArchiveId?: string;
  pageID?: string;
  pageId?: string;
  pageName?: string;
  isActive?: boolean;
  publisherPlatform?: string[];
  startDateFormatted?: string;
  endDateFormatted?: string;
  startDate?: number;
  endDate?: number;
  snapshot?: {
    pageName?: string;
    pageProfileUri?: string;
    pageCategories?: string[];
    title?: string;
    body?: { text?: string } | string;
    linkUrl?: string;
    linkDescription?: string;
    ctaText?: string;
    displayFormat?: string;
    videos?: Array<{ videoHdUrl?: string; videoSdUrl?: string; videoPreviewImageUrl?: string; video_hd_url?: string; video_preview_image_url?: string }>;
    images?: Array<{ originalImageUrl?: string; resizedImageUrl?: string; original_image_url?: string; resized_image_url?: string }>;
    cards?: Array<{ videoHdUrl?: string; videoPreviewImageUrl?: string; originalImageUrl?: string; resizedImageUrl?: string; title?: string; body?: string }>;
  };
}

function epochOrIso(iso?: string, epoch?: number): string | null {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof epoch === "number" && epoch > 0) return new Date(epoch * 1000).toISOString();
  return null;
}

/** One actor item → MetaAd. Pure; tolerant of the actor's camelCase / snake_case drift. */
export function normalizeMetaAd(item: ApifyAdItem): MetaAd | null {
  const id = clean(item.adArchiveID ?? item.adArchiveId);
  if (!id) return null;
  const s = item.snapshot ?? {};
  const videos = s.videos ?? [];
  const images = s.images ?? [];
  const cards = s.cards ?? [];
  const videoUrl = clean(videos[0]?.videoHdUrl ?? videos[0]?.video_hd_url ?? videos[0]?.videoSdUrl ?? cards.find((c) => c.videoHdUrl)?.videoHdUrl);
  const imageUrls = [
    ...images.map((i) => clean(i.originalImageUrl ?? i.original_image_url ?? i.resizedImageUrl ?? i.resized_image_url)),
    ...cards.map((c) => clean(c.originalImageUrl ?? c.resizedImageUrl)),
  ].filter((u): u is string => !!u);
  const thumb = clean(videos[0]?.videoPreviewImageUrl ?? videos[0]?.video_preview_image_url ?? cards.find((c) => c.videoPreviewImageUrl)?.videoPreviewImageUrl) ?? imageUrls[0] ?? null;
  const format = clean(s.displayFormat)?.toUpperCase() ?? null;
  const media_kind: AdMediaKind = videoUrl ? "video" : format === "CAROUSEL" || cards.length > 1 ? "carousel" : imageUrls.length ? "image" : "unknown";
  const body = typeof s.body === "string" ? clean(s.body) : clean(s.body?.text);
  return {
    source_ad_id: id,
    page_id: clean(item.pageID ?? item.pageId),
    page_name: clean(s.pageName ?? item.pageName),
    page_url: clean(s.pageProfileUri),
    page_category: clean(s.pageCategories?.[0]),
    ad_library_url: `https://www.facebook.com/ads/library/?id=${id}`,
    title: clean(s.title) ?? clean(cards[0]?.title),
    body: body ?? clean(cards[0]?.body),
    link_url: clean(s.linkUrl),
    link_description: clean(s.linkDescription),
    cta_text: clean(s.ctaText),
    display_format: format,
    media_kind,
    image_urls: imageUrls,
    video_url: videoUrl,
    thumbnail_url: thumb,
    platforms: (item.publisherPlatform ?? []).map((p) => String(p).toLowerCase()),
    started_at: epochOrIso(item.startDateFormatted, item.startDate),
    ended_at: epochOrIso(item.endDateFormatted, item.endDate),
    is_active: typeof item.isActive === "boolean" ? item.isActive : null,
    raw: item as unknown as Record<string, unknown>,
  };
}

/** Build a Meta Ad Library search URL for a keyword. Pure. */
export function adLibrarySearchUrl(query: string, country: string, mediaType: AdMediaType, activeOnly: boolean): string {
  const p = new URLSearchParams({
    active_status: activeOnly ? "active" : "all",
    ad_type: "all",
    country: country.toUpperCase(),
    q: query.trim(),
    search_type: "keyword_unordered",
  });
  if (mediaType !== "all") p.set("media_type", mediaType);
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

/** True for a facebook.com Ad Library or page URL. Pure. */
export function isMetaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)facebook\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

export function pullCostUsd(count: number): number {
  return Math.round(count * env.APIFY_ADS_USD_PER_AD * 1000) / 1000;
}

export function isAdsPullConfigured(): boolean {
  return env.APIFY_TOKEN.trim().length > 0;
}

export async function pullMetaAds(opts: {
  startUrl: string;
  limit: number;
  activeOnly: boolean;
  shouldStop?: () => boolean;
}): Promise<MetaAd[]> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN missing");
  const cap = Math.max(1, Math.min(opts.limit, env.ADS_MAX_PER_PULL));
  log.info({ url: opts.startUrl, limit: cap }, "apify_ads.run.start");
  const startResp = await retry(
    () =>
      fetch(`${BASE_URL}/acts/${ACTOR}/runs?token=${env.APIFY_TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startUrls: [{ url: opts.startUrl }], resultsLimit: cap, activeStatus: opts.activeOnly ? "active" : "all" }),
      }),
    { maxAttempts: 3 },
  );
  if (!startResp.ok) throw new Error(`apify_ads.run.error ${startResp.status}: ${await startResp.text()}`);
  const run = ((await startResp.json()) as { data?: { id?: string; defaultDatasetId?: string; status?: string } }).data;
  const runId = run?.id;
  const datasetId = run?.defaultDatasetId;
  if (!runId || !datasetId) throw new Error("apify_ads.run.error: missing run id / dataset id");

  const deadline = Date.now() + RUN_DEADLINE_MS;
  let status = run?.status ?? "RUNNING";
  let stopped = false;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    if (opts.shouldStop?.()) {
      stopped = true;
      await fetch(`${BASE_URL}/actor-runs/${runId}/abort?token=${env.APIFY_TOKEN}`, { method: "POST" }).catch(() => null);
      break;
    }
    if (Date.now() > deadline) {
      log.warn({ runId, status }, "apify_ads.run.deadline — reading partial dataset");
      break;
    }
    await sleep(POLL_INTERVAL_MS);
    try {
      const s = await fetch(`${BASE_URL}/actor-runs/${runId}?token=${env.APIFY_TOKEN}`);
      if (s.ok) status = ((await s.json()) as { data?: { status?: string } }).data?.status ?? status;
    } catch {
      /* transient */
    }
  }
  if (!stopped && (status === "FAILED" || status === "ABORTED")) throw new Error(`apify_ads.run.${status.toLowerCase()} (run ${runId})`);

  const itemsResp = await retry(() => fetch(`${BASE_URL}/datasets/${datasetId}/items?token=${env.APIFY_TOKEN}&clean=true&limit=${cap}`), { maxAttempts: 3 });
  if (!itemsResp.ok) throw new Error(`apify_ads.dataset.error ${itemsResp.status}: ${await itemsResp.text()}`);
  const items = (await itemsResp.json()) as ApifyAdItem[];
  const ads = items.map(normalizeMetaAd).filter((a): a is MetaAd => !!a);
  log.info({ count: ads.length, runId, status }, "apify_ads.run.done");
  return ads;
}
