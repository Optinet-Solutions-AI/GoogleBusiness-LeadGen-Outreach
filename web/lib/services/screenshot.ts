/**
 * screenshot.ts — Capture a PNG screenshot of a deployed demo site.
 *
 * Inputs:  a public http(s) URL (the live demo site)
 * Outputs: a hero-clipped desktop PNG Buffer, or null on any failure (never throws)
 * Used by: lib/pipeline/stage-4b-screenshot.ts
 *
 * Reuses the shared Chromium singleton (headless-browser.ts). No proxy — we're
 * screenshotting our OWN pages.dev site, so direct egress is correct. Requires
 * Chromium, so this only produces an image where Playwright is installed (the
 * Cloud Run job); locally it fails closed and returns null.
 */

import type { BrowserContext } from "playwright";
import { getBrowser } from "./headless-browser";
import { getLogger } from "../logger";

const log = getLogger("screenshot");

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const VIEWPORT = { width: 1440, height: 900 };

export async function captureDemoScreenshot(url: string): Promise<Buffer | null> {
  let context: BrowserContext | null = null;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({ viewport: VIEWPORT, userAgent: DESKTOP_UA });
    const page = await context.newPage();

    // The demo was just deployed — give Cloudflare a moment to propagate and
    // retry a few times before giving up.
    let loaded = false;
    for (let attempt = 0; attempt < 4 && !loaded; attempt++) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
        loaded = true;
      } catch (e) {
        if (attempt === 3) throw e;
        await page.waitForTimeout(2_500);
      }
    }

    // Hero shot only (top 1440x900) — a full-page capture is far too tall to
    // embed legibly inside an email.
    const buf = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });
    return buf as Buffer;
  } catch (e) {
    log.warn({ url, err: (e as Error).message }, "screenshot.capture_failed");
    return null;
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}
