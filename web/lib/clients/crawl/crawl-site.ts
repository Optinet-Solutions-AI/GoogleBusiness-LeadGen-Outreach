/**
 * crawl-site.ts — crawl a client website into source_pages + copied brand assets.
 *
 * Inputs:  SourceRow (website/demo_site), ClientRow, maxPages
 * Outputs: source_pages rows (old ones replaced), brand_assets copies, updated client_sources row,
 *          brand colour + logo asset + time spent copying assets
 * Used by: lib/clients/build-brain.ts (MODE=brand-brain)
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import {
  BROWSER_UA,
  extractWebsiteImages,
} from "@/lib/services/website-images";
import { extractWebsiteBrand } from "@/lib/services/website-brand";
import { getBrowser } from "@/lib/services/headless-browser";
import { copyRemoteImage } from "@/lib/clients/assets";
import type { ClientRow } from "@/lib/clients/clients";
import type { SourceRow } from "@/lib/clients/sources";
import { htmlToText } from "./html-to-text";
import { pickCrawlLinks } from "./page-select";

const log = getLogger("crawl-site");
const PAGE_TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 2_000_000;
const MIN_TEXT = 200;
const MAX_IMAGES = 30;

/**
 * Lets a WAF rule recognise our crawler without changing the browser User-Agent. The value is a secret
 * (BRAND_BRAIN_CRAWLER_TOKEN) so the rule cannot be matched by anyone who reads this code; unset = no header.
 */
export function crawlerHeaders(): Record<string, string> {
  const token = env.BRAND_BRAIN_CRAWLER_TOKEN.trim();
  return token ? { "x-rateup-crawler": token } : {};
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Same site, or a subdomain of it (cdn.example.com for example.com). */
export function sameSite(url: string, siteUrl: string): boolean {
  const a = hostOf(url);
  const b = hostOf(siteUrl);
  return !!a && !!b && (a === b || a.endsWith(`.${b}`));
}

/** The token goes only to the client's own site — never to third-party CDNs or embeds. */
function headersFor(url: string, siteUrl: string): Record<string, string> {
  return sameSite(url, siteUrl) ? crawlerHeaders() : {};
}

/** Last HTTP status seen by fetchHtml for a non-OK response (null when it threw or succeeded). */
let lastStatus: number | null = null;

async function fetchHtml(url: string): Promise<string | null> {
  lastStatus = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,*/*",
        ...crawlerHeaders(),
      },
    });
    if (!res.ok) {
      lastStatus = res.status;
      return null;
    }
    if (parseInt(res.headers.get("content-length") ?? "0", 10) > MAX_PAGE_BYTES)
      return null;
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|xml|text/i.test(type)) return null;
    const reader = res.body?.getReader();
    if (!reader) return (await res.text()).slice(0, MAX_PAGE_BYTES);
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
    }
    ctrl.abort();
    return Buffer.concat(chunks).subarray(0, MAX_PAGE_BYTES).toString("utf8");
  } catch (err) {
    log.warn(
      { url: url.slice(0, 100), err: String(err).slice(0, 200) },
      "crawl_site.fetch_failed",
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** JS-rendered fallback; returns null when Playwright is unavailable. */
async function renderHtml(url: string): Promise<string | null> {
  try {
    const browser = await getBrowser();
    const ctx = await browser.newContext({ userAgent: BROWSER_UA });
    const token = crawlerHeaders();
    if (Object.keys(token).length) {
      // add the token to same-site requests only (extraHTTPHeaders would send it to every subresource host)
      await ctx.route("**/*", (route) => {
        const req = route.request();
        if (!sameSite(req.url(), url)) return route.continue();
        return route.continue({ headers: { ...req.headers(), ...token } });
      });
    }
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
      return (await page.content()).slice(0, MAX_PAGE_BYTES);
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch (err) {
    log.info(
      { url: url.slice(0, 100), err: String(err).slice(0, 120) },
      "crawl_site.render_unavailable",
    );
    return null;
  }
}

type Brand = { logo_asset_id: string | null; brand_color: string | null };

export async function crawlSite(
  source: SourceRow,
  opts: { maxPages: number; client: ClientRow },
): Promise<{
  pages: number;
  images: number;
  status: "crawled" | "partial" | "failed";
  brand: Brand;
  /** Milliseconds spent downloading/copying images and the logo (the build caps total asset-copy time). */
  asset_ms: number;
}> {
  const db = getDb();
  const clientId = opts.client.id;
  const homeUrl = source.url ?? opts.client.website_url;
  const noBrand: Brand = { logo_asset_id: null, brand_color: null };
  const finish = async (
    status: "crawled" | "partial" | "failed",
    pages: number,
    images: number,
    brand: Brand,
    lastError: string | null,
    assetMs = 0,
  ) => {
    await db
      .from("client_sources")
      .update({
        status,
        page_count: pages,
        last_crawled_at: new Date().toISOString(),
        last_error: lastError,
      })
      .eq("id", source.id);
    return { pages, images, status, brand, asset_ms: assetMs };
  };

  if (!homeUrl) return finish("failed", 0, 0, noBrand, "source has no url");

  let homeHtml = await fetchHtml(homeUrl);
  if (!homeHtml)
    return finish(
      "failed",
      0,
      0,
      noBrand,
      lastStatus
        ? `home page could not be fetched (HTTP ${lastStatus})`
        : "home page could not be fetched",
    );

  let home = htmlToText(homeHtml);
  if (home.text.length < MIN_TEXT) {
    const rendered = await renderHtml(homeUrl);
    if (rendered) {
      const r = htmlToText(rendered);
      if (r.text.length > home.text.length) {
        homeHtml = rendered;
        home = r;
      }
    }
  }

  const rows: {
    source_id: string;
    client_id: string;
    url: string;
    title: string | null;
    text: string;
  }[] = [
    {
      source_id: source.id,
      client_id: clientId,
      url: homeUrl,
      title: home.title,
      text: home.text,
    },
  ];
  const links = pickCrawlLinks(
    homeHtml,
    homeUrl,
    Math.max(0, opts.maxPages - 1),
  );
  let linkFailures = 0;
  for (const link of links) {
    const html = await fetchHtml(link);
    if (!html) {
      linkFailures++;
      continue;
    }
    const t = htmlToText(html);
    rows.push({
      source_id: source.id,
      client_id: clientId,
      url: link,
      title: t.title,
      text: t.text,
    });
  }

  await db.from("source_pages").delete().eq("source_id", source.id);
  const { error: insErr } = await db.from("source_pages").insert(rows);
  if (insErr)
    return finish(
      "failed",
      0,
      0,
      noBrand,
      `page insert failed: ${insErr.message}`.slice(0, 300),
    );

  let images = 0;
  const assetStart = Date.now();
  try {
    const urls = await extractWebsiteImages(homeUrl, { headers: crawlerHeaders() });
    for (const u of urls) {
      if (images >= MAX_IMAGES) break;
      const a = await copyRemoteImage({
        clientId,
        url: u,
        origin: "website",
        kind: "photo",
        headers: headersFor(u, homeUrl),
      }).catch(() => null);
      if (a) images++;
    }
  } catch (err) {
    log.warn(
      { sourceId: source.id, err: String(err).slice(0, 200) },
      "crawl_site.images_failed",
    );
  }

  const brand: Brand = { logo_asset_id: null, brand_color: null };
  try {
    const b = await extractWebsiteBrand(homeUrl, { headers: crawlerHeaders() });
    brand.brand_color = b.brand_color ?? null;
    if (b.logo_url) {
      const logo = await copyRemoteImage({
        clientId,
        url: b.logo_url,
        origin: "website",
        kind: "logo",
        headers: headersFor(b.logo_url, homeUrl),
      }).catch(() => null);
      brand.logo_asset_id = logo?.id ?? null;
    }
  } catch (err) {
    log.warn(
      { sourceId: source.id, err: String(err).slice(0, 200) },
      "crawl_site.brand_failed",
    );
  }

  const mostlyFailed = links.length > 0 && linkFailures * 2 > links.length;
  const status = rows.length >= 2 && !mostlyFailed ? "crawled" : "partial";
  return finish(
    status,
    rows.length,
    images,
    brand,
    linkFailures ? `${linkFailures} page(s) failed to fetch` : null,
    Date.now() - assetStart,
  );
}
