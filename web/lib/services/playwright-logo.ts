/**
 * playwright-logo.ts — Fetch a profile picture URL from a Facebook or
 * Instagram page by rendering it in headless Chromium and reading og:image.
 *
 * Inputs:  social URL + kind ("facebook" | "instagram")
 * Outputs: profile picture URL string, or null on any failure
 * Used by: lib/services/logo.ts (between Brandfetch and monogram branches)
 *
 * Why headless browser instead of plain fetch:
 *   - FB and IG return different HTML to JS-disabled clients (often a login
 *     wall or stub page with no og:image). A real browser session gets the
 *     proper meta tags.
 *   - Some CDN edges block plain fetch user-agents but allow a real-browser
 *     UA + viewport.
 *
 * Honest limitations (read before tweaking):
 *   1. CDN URLs returned by FB/IG expire in ~1-4 weeks. The caller caches
 *      the result on lead.logo_url; rebuilds re-fetch.
 *   2. Personal Instagram accounts increasingly redirect to a login wall.
 *      When that happens, og:image is absent → return null → monogram.
 *   3. At scale (>~100 fetches/hr from the same IP), FB/IG flag bot traffic
 *      and start serving captcha or 429. No bypass without proxy rotation.
 *   4. DOM/og:image semantics shift over time. When they do, this module's
 *      selectors break silently; failures fall back to monogram, so the
 *      pipeline never crashes.
 *
 * Cost:
 *   - Local: ~5s wall time for the first call (Chromium launch), ~1-2s for
 *     subsequent calls (browser singleton reuse).
 *   - Cloud Run: same. Memory bumps to ~512MB while a fetch is in flight.
 */

import type { Browser, BrowserContext, Page } from "playwright";
import { getLogger } from "../logger";

const log = getLogger("playwright-logo");

const FETCH_TIMEOUT_MS = 8_000;
const NAV_TIMEOUT_MS = 8_000;

// Mobile Chrome 131 on Android — looks unremarkable, gets less aggressive
// bot-detection than headless-Chrome defaults.
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

let browserPromise: Promise<Browser> | null = null;

/**
 * Lazy-launch a single Chromium instance per Node process. The Cloud Run
 * job container is short-lived (one batch per invocation), so a single
 * browser shared across leads saves ~4s/lead vs. launching per-call.
 */
async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  // Import dynamically so Next.js dashboard routes that never call this
  // (most of them) don't bundle Playwright into their cold-start path.
  const { chromium } = await import("playwright");
  browserPromise = chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  return browserPromise;
}

/**
 * Close the singleton browser. Useful at the end of a Cloud Run job so the
 * container can exit cleanly. Safe to call multiple times.
 */
export async function closePlaywrightBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => undefined);
}

/**
 * Fetch a logo URL from a social profile page.
 *
 * Returns the profile picture URL on success, or null on any failure
 * (timeout, login wall, missing og:image, captcha redirect, etc.). Never
 * throws — callers fall back to monogram.
 */
export async function fetchLogoFromSocial(
  url: string,
  kind: "facebook" | "instagram",
): Promise<string | null> {
  const startMs = Date.now();
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: MOBILE_UA,
      viewport: { width: 390, height: 844 },
      locale: "en-US",
      // Block heavy resources we don't need (images, fonts, media) — the
      // og:image meta tag is in the HTML, doesn't require the actual image
      // to load. Speeds up the fetch + reduces detection surface.
      bypassCSP: true,
    });

    // Drop heavy + unnecessary resources before they hit the wire.
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font" || type === "stylesheet") {
        return route.abort();
      }
      route.continue();
    });

    page = await context.newPage();

    // Run in parallel: navigate + a hard wall-clock timeout so a hung
    // page can't block the orchestrator.
    const navResult = await Promise.race([
      page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
    ]);

    if (!navResult) {
      log.warn({ url, kind }, "playwright_logo.timeout");
      return null;
    }

    // Detect login wall — FB and IG both redirect to /login when blocking.
    const finalUrl = page.url();
    if (/\/login(\/|\?|$)|\/accounts\/login/.test(finalUrl)) {
      log.info({ url, kind, finalUrl }, "playwright_logo.login_wall");
      return null;
    }

    // og:image is the primary signal. For IG profile pages it's exactly
    // the profile picture; for FB pages it's the page's profile picture
    // when the page is public.
    const ogImage = await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute("content")
      .catch(() => null);

    if (ogImage && /^https?:\/\//.test(ogImage)) {
      log.info(
        { url, kind, durationMs: Date.now() - startMs },
        "playwright_logo.resolved.og_image",
      );
      return ogImage;
    }

    log.info({ url, kind }, "playwright_logo.no_og_image");
    return null;
  } catch (err) {
    log.warn(
      { url, kind, err: String(err).slice(0, 200), durationMs: Date.now() - startMs },
      "playwright_logo.failed",
    );
    return null;
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
}
