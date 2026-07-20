/**
 * website-images.ts — Scrape a business's REAL content images from its own site.
 *
 * Inputs:  website_url (a real owned site)
 * Outputs: string[] of absolute image URLs (content/gallery photos), capped
 * Used by: stage-2-enrich (old_website / has_website leads) → merged into leads.photos
 *
 * Complements website-brand.ts (which pulls only the header LOGO). Here we grab
 * the site's actual content imagery — hero shots, gallery <img>, og:image, and
 * inline CSS background-image — so an Improve demo can show THEIR real photos
 * instead of Google Maps stock. Plain fetch + regex (no Chromium), so it only
 * sees server-rendered HTML; SPA-only galleries won't surface here (that's fine
 * — Google Maps photos still merge in). Filters out logos, icons, badges, and
 * third-party/tracking images. Never throws — returns [] on any failure.
 */

import { looksParked } from "./parking";
import { getLogger } from "../logger";

const log = getLogger("website-images");
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Third-party badges / widgets / payment seals — never real content photos.
 *  Mirrors the list in website-brand.ts so both stay consistent. */
const THIRD_PARTY =
  /uber|yelp|\bbbb\b|angi|nextdoor|trustpilot|home ?advisor|facebook|instagram|twitter|linkedin|\bgoogle\b|gstatic|godaddy|wix\b|squarespace|badge|award|seal|verified|partner|powered.?by|review|rating|five.?star|\bstars?\b|visa|mastercard|paypal|financing/i;
/** Logo / chrome / tracking-pixel markers — exclude from content imagery. */
const NON_CONTENT = /\blogo\b|sprite|favicon|icon-|\bicon\b|placeholder|spinner|loader|1x1|pixel|spacer|blank\./i;

const MAX_IMAGES = 8;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&").replace(/&#38;/g, "&").replace(/&#x26;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}
function abs(href: string, base: string): string | null {
  try {
    return new URL(decodeEntities(href), base).toString();
  } catch {
    return null;
  }
}
function firstAttr(tag: string, attr: string): string | null {
  const m = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m ? m[1].trim() : null;
}
function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
}

/** True when the URL points at a real raster photo we'd want to display.
 *  Drops data: URIs, SVG/GIF (usually icons/logos), and non-content markers. */
function isDisplayablePhoto(url: string): boolean {
  if (/^data:/i.test(url)) return false;
  if (/\.(svg|gif)(\?|$)/i.test(url)) return false;
  if (NON_CONTENT.test(url) || THIRD_PARTY.test(url)) return false;
  return true;
}

/**
 * Fetch a site's homepage HTML and return up to MAX_IMAGES absolute content
 * image URLs. Best-effort, never throws. Validation that each URL actually
 * serves an image is left to the caller (stage-2's urlServesImage pass), so
 * this stays a pure parse with no extra network round-trips per image.
 */
export async function extractWebsiteImages(websiteUrl: string): Promise<string[]> {
  let html: string | null = null;
  let finalUrl = websiteUrl;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(websiteUrl, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": BROWSER_UA, accept: "text/html,*/*" },
    });
    finalUrl = res.url || websiteUrl;
    if (res.ok) html = await res.text();
    else log.info({ url: websiteUrl, status: res.status }, "images.bad_status");
  } catch (err) {
    log.info({ url: websiteUrl, err: String(err).slice(0, 120) }, "images.fetch_failed");
  } finally {
    clearTimeout(t);
  }

  if (!html) return [];
  // Parked / for-sale domains belong to the parking service — their imagery is
  // the parking lander's, not the business's.
  if (looksParked(html, finalUrl)) {
    log.info({ url: websiteUrl, finalUrl }, "images.parked_domain");
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null) => {
    if (!raw || out.length >= MAX_IMAGES) return;
    const u = abs(raw, finalUrl);
    if (!u || seen.has(u) || !isDisplayablePhoto(u)) return;
    // Guard on the source attribute too — the resolved URL can be clean while
    // the tag's class/alt marked it as a logo/badge.
    seen.add(u);
    out.push(u);
  };

  // 1) og:image — usually the site's flagship hero/share image.
  for (const meta of tags(html, "meta")) {
    if (/property\s*=\s*["']og:image["']/i.test(meta)) push(firstAttr(meta, "content"));
  }

  // 2) content <img> — skip any whose class/id/alt/src reads as chrome.
  for (const img of tags(html, "img")) {
    if (out.length >= MAX_IMAGES) break;
    const hay = `${firstAttr(img, "class") ?? ""} ${firstAttr(img, "id") ?? ""} ${firstAttr(img, "alt") ?? ""} ${firstAttr(img, "src") ?? ""}`.toLowerCase();
    if (NON_CONTENT.test(hay) || THIRD_PARTY.test(hay)) continue;
    // Prefer the largest srcset candidate; fall back to src / data-src / lazy attrs.
    const srcset = firstAttr(img, "srcset") ?? firstAttr(img, "data-srcset");
    if (srcset) {
      const largest = srcset
        .split(",")
        .map((s) => s.trim().split(/\s+/)[0])
        .filter(Boolean)
        .pop();
      if (largest) push(largest);
    }
    push(firstAttr(img, "src") ?? firstAttr(img, "data-src") ?? firstAttr(img, "data-lazy-src"));
  }

  // 3) inline CSS background-image:url(...) — common for hero sections.
  const bgRe = /background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi;
  let m: RegExpExecArray | null;
  while ((m = bgRe.exec(html)) && out.length < MAX_IMAGES) push(m[2]);

  log.info({ url: websiteUrl, count: out.length }, "images.done");
  return out.slice(0, MAX_IMAGES);
}
