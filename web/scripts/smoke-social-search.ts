/**
 * smoke-social-search.ts — Manual smoke test for findSocialUrl.
 *
 * Run with:
 *   npx tsx scripts/smoke-social-search.ts "<business name>" [city] [country_code]
 *
 * Example:
 *   npx tsx scripts/smoke-social-search.ts "The Little Things Balloon Garlands" Hamilton NZ
 */
import { findSocialUrl } from "../lib/services/social-search";
import { closePlaywrightBrowser } from "../lib/services/headless-browser";

(async () => {
  const [name, city, cc] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: npx tsx scripts/smoke-social-search.ts "<business name>" [city] [country_code]');
    process.exit(2);
  }
  const startMs = Date.now();
  const result = await findSocialUrl({ business_name: name, city: city ?? null, country_code: cc ?? null });
  console.log(`Business: ${name}`);
  console.log(`City:     ${city ?? "<none>"}`);
  console.log(`Country:  ${cc ?? "<none>"}`);
  console.log(`Result:   ${result ? `${result.kind} → ${result.url}` : "<null>"}`);
  console.log(`Elapsed:  ${Date.now() - startMs}ms`);
  // The shared Chromium singleton would otherwise keep this script alive.
  await closePlaywrightBrowser();
})();
