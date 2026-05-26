/**
 * headless-browser.ts — Shared Chromium singleton + per-context proxy helper.
 *
 * Inputs:  optional PROXY_* env vars (see lib/config.ts)
 * Outputs:
 *   - getBrowser(): lazily-launched Playwright Browser instance (singleton)
 *   - buildProxyOptions(country): { server, username, password } for newContext,
 *     or null when no proxy env is configured.
 *   - closePlaywrightBrowser(): idempotent shutdown
 *
 * Why per-context proxy (not launch-time):
 *   Residential proxies route per-country, and different leads come from
 *   different countries. Setting proxy at launch would lock the whole
 *   singleton to one country. Setting it per-newContext lets each fetch
 *   pick the right egress location while still sharing one browser process.
 *
 * Used by: lib/services/playwright-logo.ts, lib/services/social-search.ts
 */

import type { Browser } from "playwright";
import { env } from "../config";

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

export interface ProxyOptions {
  server: string;
  username?: string;
  password?: string;
}

/**
 * Build the Playwright `proxy:` option for a single context.
 *
 * Returns null when PROXY_SERVER isn't configured — callers create the
 * context without a proxy (direct egress) so local dev keeps working.
 * Returns the proxy config with the country code substituted into
 * PROXY_USERNAME_TEMPLATE when set.
 *
 * @param countryCode  ISO 3166-1 alpha-2 (lowercase or upper, we normalize).
 *                     Falls back to env.PROXY_DEFAULT_COUNTRY when blank.
 */
export function buildProxyOptions(countryCode?: string | null): ProxyOptions | null {
  if (!env.PROXY_SERVER) return null;
  const country = (countryCode || env.PROXY_DEFAULT_COUNTRY || "us").toUpperCase();
  const username = env.PROXY_USERNAME_TEMPLATE
    ? env.PROXY_USERNAME_TEMPLATE.replace("{COUNTRY}", country)
    : undefined;
  return {
    server: env.PROXY_SERVER,
    ...(username ? { username } : {}),
    ...(env.PROXY_PASSWORD ? { password: env.PROXY_PASSWORD } : {}),
  };
}
