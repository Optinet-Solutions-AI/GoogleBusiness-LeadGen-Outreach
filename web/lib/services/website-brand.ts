/**
 * website-brand.ts — Extract a business's real logo + brand color from its site.
 *
 * Inputs:  website_url (a real owned site)
 * Outputs: { brand_color, logo_url, color_source, logo_source } — nulls when unfound
 * Used by: scripts/backfill-website-brand.ts (and, later, stage-1/stage-2 enrich)
 *
 * Strategy (no Chromium, plain fetch + regex — works on server-rendered HTML):
 *   logo:  header <img> mentioning "logo" → apple-touch-icon → <link rel=icon>
 *          → og:image → Google favicon service (works even if the site blocks us).
 *   color: dominant color of that logo (Vibrant), preferred so accent ↔ logo
 *          match; else the site's <meta theme-color>; else the favicon color.
 *          Grayscale/near-white/near-black results are rejected as accents so a
 *          mono logo doesn't yield a gray accent — the caller then falls back to
 *          the photo-derived color.
 * Even when the site fetch fails, we still return a favicon-based logo + color.
 * Never throws.
 */

import { extractBrandColor, FALLBACK_HEX } from "./color-extractor";
import { getLogger } from "../logger";

const log = getLogger("website-brand");
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// Instagram/Facebook serve og:image (the profile picture) ONLY to known
// crawler UAs — a browser UA gets the JS app shell (IG) or a 400 (FB). This is
// the standard link-preview path, no headless browser required.
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const SOCIAL_RE = /(?:^|\.)(instagram\.com|facebook\.com|fb\.com)$/i;

export interface WebsiteBrand {
  brand_color: string | null;
  logo_url: string | null;
  color_source: "theme-color" | "logo" | "og-image" | "favicon" | null;
  logo_source: "img-logo" | "apple-touch-icon" | "icon" | "og-image" | "favicon" | null;
}

/** Decode the HTML entities that appear in attribute values (esp. og:image URLs
 *  full of `&amp;`), otherwise the URL 403s / fails to fetch. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&").replace(/&#38;/g, "&").replace(/&#x26;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}
function abs(href: string, base: string): string | null {
  try { return new URL(decodeEntities(href), base).toString(); } catch { return null; }
}
function domainOf(u: string): string | null {
  try { return new URL(u.includes("://") ? u : `https://${u}`).hostname.replace(/^www\./, ""); } catch { return null; }
}
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}
function firstAttr(tag: string, attr: string): string | null {
  const m = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m ? m[1].trim() : null;
}
function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
}
function isHex(s: string | null): s is string {
  return !!s && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
}
function rgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Reject near-white / near-black AND near-gray (low saturation) — none make a
 *  usable brand accent. A mono/grayscale logo therefore yields no color, so the
 *  caller falls back to the photo-derived color instead of shipping gray. */
function isUsableAccent(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum <= 0.06 || lum >= 0.93) return false;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return sat >= 0.18; // drops #7F7F7F-style grays
}
function isRasterUrl(u: string | null): u is string {
  return !!u && !/\.(svg|webp)(\?|$)/i.test(u) && !/^data:image\/(svg|webp)/i.test(u);
}

/** Vibrant color of an image URL, or null if unusable (mono/white/undecodable). */
async function colorOf(url: string): Promise<string | null> {
  if (!isRasterUrl(url)) return null;
  try {
    const hex = await extractBrandColor(url);
    if (isHex(hex) && hex.toUpperCase() !== FALLBACK_HEX.toUpperCase() && isUsableAccent(hex)) {
      return hex.toUpperCase();
    }
  } catch { /* swallow */ }
  return null;
}

export async function extractWebsiteBrand(websiteUrl: string): Promise<WebsiteBrand> {
  const domain = domainOf(websiteUrl);
  const isSocial = !!domain && SOCIAL_RE.test(domain);
  let html: string | null = null;
  let finalUrl = websiteUrl;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(websiteUrl, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": isSocial ? CRAWLER_UA : BROWSER_UA, accept: "text/html,*/*" },
    });
    finalUrl = res.url || websiteUrl;
    if (res.ok) html = await res.text();
    else log.info({ url: websiteUrl, status: res.status }, "brand.bad_status");
  } catch (err) {
    log.info({ url: websiteUrl, err: String(err).slice(0, 120) }, "brand.fetch_failed");
  } finally {
    clearTimeout(t);
  }

  // Third-party badges/widgets that masquerade as "logo" images (Emergency
  // Chiropractic's page had an UBER Health badge that got grabbed). Also
  // payment/review/award seals. These must never become the displayed logo.
  const THIRD_PARTY = /uber|yelp|\bbbb\b|angi|nextdoor|trustpilot|home ?advisor|facebook|instagram|twitter|linkedin|\bgoogle\b|gstatic|godaddy|wix\b|squarespace|badge|award|seal|verified|partner|powered.?by|review|rating|five.?star|\bstars?\b|visa|mastercard|paypal|financing/i;

  let themeColor: string | null = null;
  let imgLogo: string | null = null;   // a real header <img> logo — display-worthy
  let appleTouchIcon: string | null = null; // square brand mark — display fallback
  let bestIcon: string | null = null;       // highest-res <link rel=icon> — display fallback
  const colorCandidates: string[] = []; // any image usable for color extraction

  if (html) {
    for (const meta of tags(html, "meta")) {
      if (/name\s*=\s*["']theme-color["']/i.test(meta)) {
        const c = firstAttr(meta, "content");
        if (isHex(c) && isUsableAccent(c!)) { themeColor = c!.toUpperCase(); break; }
      }
    }
    // og:image — on a SOCIAL page (fetched with the crawler UA) this is the
    // business's profile picture, i.e. their logo.
    let ogImage: string | null = null;
    for (const meta of tags(html, "meta")) {
      if (/property\s*=\s*["']og:image["']/i.test(meta)) { ogImage = abs(firstAttr(meta, "content") ?? "", finalUrl); break; }
    }

    if (isSocial) {
      if (ogImage) imgLogo = ogImage; // profile picture = the logo
    } else {
      // Display logo: a header <img> whose class/id/alt/src says "logo" and is
      // NOT a third-party badge. The only source we trust to SHOW on a website.
      for (const img of tags(html, "img")) {
        const hay = `${firstAttr(img, "class") ?? ""} ${firstAttr(img, "id") ?? ""} ${firstAttr(img, "alt") ?? ""} ${firstAttr(img, "src") ?? ""}`.toLowerCase();
        const src = firstAttr(img, "src") ?? firstAttr(img, "data-src");
        if (src && /\blogo\b/.test(hay) && !/sprite|icon-/.test(hay) && !THIRD_PARTY.test(hay)) {
          imgLogo = abs(src, finalUrl); break;
        }
      }
      // apple-touch-icon / <link rel=icon>: clean square brand marks. Great for
      // the accent AND a solid DISPLAY logo when the site has no header <img>
      // logo (most logos live here as a 180x180 png — far better than a monogram).
      for (const link of tags(html, "link")) {
        if (/rel\s*=\s*["'][^"']*apple-touch-icon[^"']*["']/i.test(link)) {
          const href = firstAttr(link, "href"); if (href) { const u = abs(href, finalUrl); if (u) { if (!appleTouchIcon) appleTouchIcon = u; colorCandidates.push(u); } }
        }
      }
      const icons = tags(html, "link").filter((l) => /rel\s*=\s*["'][^"']*\bicon\b[^"']*["']/i.test(l));
      icons.sort((a, b) => (Number(firstAttr(b, "sizes")?.split("x")[0]) || 0) - (Number(firstAttr(a, "sizes")?.split("x")[0]) || 0));
      if (icons[0]) { const h = firstAttr(icons[0], "href"); if (h) { const u = abs(h, finalUrl); if (u) { bestIcon = u; colorCandidates.push(u); } } }
    }
  }
  const favicon = domain ? faviconUrl(domain) : null;

  // ── DISPLAY logo: header <img> → apple-touch-icon → high-res <link icon>.
  //    (On a social page imgLogo IS the og:image profile picture.) Only the
  //    site's OWN assets — never the generic Google favicon service. ─────────
  const logo_url = imgLogo ?? (isSocial ? null : (appleTouchIcon ?? bestIcon));
  const logo_source: WebsiteBrand["logo_source"] =
    imgLogo ? (isSocial ? "og-image" : "img-logo")
      : appleTouchIcon ? "apple-touch-icon"
        : bestIcon ? "icon"
          : null;

  // ── color: displayed logo → theme-color → icon → favicon ──────────────────
  let brand_color: string | null = null;
  let color_source: WebsiteBrand["color_source"] = null;
  if (imgLogo) { const c = await colorOf(imgLogo); if (c) { brand_color = c; color_source = "logo"; } }
  if (!brand_color && themeColor) { brand_color = themeColor; color_source = "theme-color"; }
  if (!brand_color) {
    for (const cand of colorCandidates) { const c = await colorOf(cand); if (c) { brand_color = c; color_source = "logo"; break; } }
  }
  // Favicon color is a last resort — but NOT for social pages, where the
  // favicon is the platform's (Instagram magenta / Facebook blue), not the
  // business's. Those fall through to null → caller keeps the photo color.
  if (!brand_color && favicon && !isSocial) { const c = await colorOf(favicon); if (c) { brand_color = c; color_source = "favicon"; } }

  log.info({ url: websiteUrl, brand_color, color_source, logo_source }, "brand.done");
  return { brand_color, logo_url, color_source, logo_source };
}
