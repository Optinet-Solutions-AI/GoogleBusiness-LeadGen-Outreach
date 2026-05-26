/**
 * headless-browser.ts — Shared Chromium singleton.
 *
 * Inputs:  none
 * Outputs: a lazily-launched Playwright Browser instance
 * Used by: lib/services/playwright-logo.ts, lib/services/social-search.ts
 *
 * The Cloud Run Job container is short-lived (one batch per invocation),
 * so a single browser shared across leads saves ~4s/lead vs. launching
 * per-call. Both fetch og:image (playwright-logo) and the search-for-
 * social-URL (social-search) reuse this instance.
 *
 * Safe to call closePlaywrightBrowser() multiple times — it's idempotent.
 * The container's exit handler should call it so Chromium child processes
 * don't outlive the Node process.
 */

import type { Browser } from "playwright";

let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  // Dynamic import keeps Playwright out of Next.js dashboard cold-start
  // bundles (none of the dashboard routes call this).
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

export async function closePlaywrightBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => undefined);
}
