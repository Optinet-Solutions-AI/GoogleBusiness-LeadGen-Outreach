/**
 * playwright-website-logo.ts — Find a business's REAL header logo by rendering
 * its website in headless Chromium and reading the rendered DOM.
 *
 * Inputs:  website URL (+ optional country for proxy egress)
 * Outputs: absolute logo image URL, or null when no real logo is found
 * Used by: lib/services/logo.ts (between the plain-fetch scrape and the monogram)
 *
 * Why headless instead of plain fetch: modern sites (Lovable / React / Wix /
 * Squarespace SPAs) render their navbar logo client-side, so a plain fetch sees
 * no <img> and falls back to the favicon — which is often a generic icon
 * (a chiropractic spine glyph, a CMS default). Rendering the page lets us read
 * the actual header logo the way a visitor sees it. If there's no real <img>
 * logo (text/SVG wordmark, background-image), we return null → caller monograms,
 * never a bare favicon. Never throws.
 */

import type { BrowserContext, Page, Route } from "playwright";
import { getBrowser } from "./headless-browser";
import { getLogger } from "../logger";

const log = getLogger("website-logo");

const NAV_TIMEOUT_MS = 12_000;
const HARD_TIMEOUT_MS = 15_000;
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Third-party badges / payment / review seals that masquerade as logos.
const THIRD_PARTY =
  /favicon|sprite|icon-|uber|yelp|\bbbb\b|angi|nextdoor|trustpilot|home.?advisor|google|gstatic|facebook|instagram|twitter|linkedin|badge|award|seal|verified|powered.?by|review|rating|stars?|visa|mastercard|paypal|financing|cookie|gravatar|hugedomains|domain.?for.?sale|parking|godaddy|sedo|afternic|wordpress\.com\/i18n/i;

interface RawImg {
  src: string; alt: string; cls: string; id: string;
  top: number; left: number; w: number; h: number; ctx: string;
}

function scoreImg(c: RawImg): number {
  const hay = `${c.src} ${c.alt} ${c.cls} ${c.id} ${c.ctx}`.toLowerCase();
  if (THIRD_PARTY.test(hay)) return -1;
  if (/^data:image\/gif/i.test(c.src)) return -1;          // tracking pixel
  if (c.w < 24 || c.h < 12) return -1;                     // too tiny
  if (c.w > 680 || c.h > 320) return -1;                   // hero/banner, not a logo
  const ar = c.w / Math.max(c.h, 1);
  if (ar > 12) return -1;                                  // skinny divider/line
  let s = 0;
  if (/\blogo\b/.test(hay)) s += 50;
  if (/\bbrand\b/.test(hay)) s += 30;
  if (/header|nav|navbar|masthead|topbar|site-?head/.test(c.ctx)) s += 25;
  if (c.top < 200) s += 20;                                // near the top
  else if (c.top < 400) s += 8;
  if (c.left < 400) s += 8;                                // typically top-left
  // mild preference for logo-shaped marks (wider than tall, not square hero)
  if (ar >= 1 && ar <= 6) s += 6;
  return s;
}

export async function fetchWebsiteLogo(
  url: string,
  countryCode?: string | null,
): Promise<string | null> {
  const startMs = Date.now();
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  try {
    // No proxy: a business's OWN website doesn't block us, and routing it
    // through the residential proxy (meant for FB/IG) just adds latency/timeouts.
    void countryCode;
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: DESKTOP_UA,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });
    // Keep images + CSS (we need layout + which <img> actually renders);
    // drop media/fonts to speed things up.
    await context.route("**/*", (route: Route) => {
      const t = route.request().resourceType();
      if (t === "media" || t === "font") return route.abort();
      route.continue();
    });
    page = await context.newPage();

    const nav = await Promise.race([
      page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }),
      new Promise<null>((r) => setTimeout(() => r(null), HARD_TIMEOUT_MS)),
    ]);
    if (!nav) { log.warn({ url }, "website_logo.timeout"); return null; }
    // give an SPA a moment to paint its navbar
    await page.waitForTimeout(1500);

    // NOTE: no inner named functions here — the bundler (tsx/esbuild) injects a
    // `__name` helper for them that doesn't exist in the page context and throws.
    const cands: RawImg[] = await page.evaluate(() => {
      const out: RawImg[] = [];
      for (const img of Array.from(document.images)) {
        const src = img.currentSrc || img.src || "";
        const r = img.getBoundingClientRect();
        if (!src || r.width <= 0 || r.top >= 700) continue;
        let ctx = "";
        let n: Element | null = img;
        for (let i = 0; i < 5 && n; i++) {
          const cls = typeof n.className === "string" ? n.className : "";
          ctx += " " + n.tagName + " " + cls + " " + n.id;
          n = n.parentElement;
        }
        out.push({
          src,
          alt: img.alt || "",
          cls: typeof img.className === "string" ? img.className : "",
          id: img.id || "",
          top: r.top, left: r.left, w: r.width, h: r.height,
          ctx: ctx.toLowerCase(),
        });
      }
      return out;
    });

    let best: RawImg | null = null;
    let bestScore = 0;
    for (const c of cands) {
      const sc = scoreImg(c);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    if (best && bestScore >= 25) {
      log.info({ url, score: bestScore, src: best.src.slice(0, 90), durationMs: Date.now() - startMs }, "website_logo.resolved");
      return best.src;
    }
    log.info({ url, candidates: cands.length, durationMs: Date.now() - startMs }, "website_logo.none");
    return null;
  } catch (err) {
    log.warn({ url, err: String(err).slice(0, 200) }, "website_logo.failed");
    return null;
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
}
