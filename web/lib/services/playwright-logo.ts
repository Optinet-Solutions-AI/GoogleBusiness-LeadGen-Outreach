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

import type { BrowserContext, Page, Route } from "playwright";
import { getBrowser, buildProxyOptions } from "./headless-browser";
import { getLogger } from "../logger";

// Re-export so existing imports (`import { closePlaywrightBrowser } from "./playwright-logo"`)
// keep working without a churn-y rename across callers.
export { closePlaywrightBrowser } from "./headless-browser";

const log = getLogger("playwright-logo");

const FETCH_TIMEOUT_MS = 8_000;
const NAV_TIMEOUT_MS = 8_000;

// Desktop Chrome 131 on macOS — verified to return real og:image content
// for FB / IG profile pages when paired with a residential proxy. The
// mobile UA we tried earlier got stripped pages from FB ("Facebook" title,
// no og:image) even with proxy; desktop UA returns proper meta tags.
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Result of a successful social-page meta-tag fetch.
 *
 * og_title + og_description carry the page's locality signal — they're
 * what the social-search locality-check uses to reject name-collision
 * false positives ("thelittlethings" can be 3 different businesses).
 */
export interface SocialPageMeta {
  og_image: string;
  og_title: string | null;
  og_description: string | null;
}

/**
 * Fetch a logo URL + page meta from a social profile.
 *
 * Returns the profile picture URL on success, or null on any failure
 * (timeout, login wall, missing og:image, captcha redirect, etc.). Never
 * throws — callers fall back to monogram.
 *
 * @param countryCode  optional ISO 3166-1 alpha-2 — picks the proxy egress
 *                     country when the residential-proxy env vars are set.
 *                     Falls back to PROXY_DEFAULT_COUNTRY when blank.
 */
export async function fetchSocialPageMeta(
  url: string,
  kind: "facebook" | "instagram",
  countryCode?: string | null,
): Promise<SocialPageMeta | null> {
  const startMs = Date.now();
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    const proxy = buildProxyOptions(countryCode);
    context = await browser.newContext({
      userAgent: DESKTOP_UA,
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      ...(proxy ? { proxy } : {}),
      // Block heavy resources we don't need (images, fonts, media) — the
      // og:image meta tag is in the HTML, doesn't require the actual image
      // to load. Speeds up the fetch + reduces detection surface.
      bypassCSP: true,
    });

    // Drop heavy + unnecessary resources before they hit the wire.
    await context.route("**/*", (route: Route) => {
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
      // og:title and og:description carry the page bio (FB shows
      // "Business · Category · City, Country" in og:description; IG packs
      // followers/bio text). Cheap to pluck from the same DOM we already
      // loaded — callers use them to reject locality mismatches before
      // accepting a slug-guess hit.
      const ogTitle = await page
        .locator('meta[property="og:title"]')
        .first()
        .getAttribute("content")
        .catch(() => null);
      const ogDescription = await page
        .locator('meta[property="og:description"]')
        .first()
        .getAttribute("content")
        .catch(() => null);
      log.info(
        {
          url,
          kind,
          durationMs: Date.now() - startMs,
          has_title: !!ogTitle,
          has_desc: !!ogDescription,
        },
        "playwright_logo.resolved.og_image",
      );
      return { og_image: ogImage, og_title: ogTitle, og_description: ogDescription };
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

/**
 * Backwards-compat shim — returns just the og:image URL for callers that
 * don't need the full meta (resolveLogo, which trusts its caller already
 * validated the page identity).
 */
export async function fetchLogoFromSocial(
  url: string,
  kind: "facebook" | "instagram",
  countryCode?: string | null,
): Promise<string | null> {
  const meta = await fetchSocialPageMeta(url, kind, countryCode);
  return meta?.og_image ?? null;
}
