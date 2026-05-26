/**
 * smoke-playwright-logo.ts — Manual smoke test for fetchLogoFromSocial.
 *
 * Run with:
 *   npx tsx scripts/smoke-playwright-logo.ts <url> <facebook|instagram>
 *
 * Example:
 *   npx tsx scripts/smoke-playwright-logo.ts https://www.instagram.com/nasa instagram
 *   npx tsx scripts/smoke-playwright-logo.ts https://www.facebook.com/cocacola facebook
 *
 * Prints the resolved logo URL on success, "<null>" on any failure.
 * Exits 0 either way — this is a smoke check, not a pass/fail gate.
 */
import { fetchLogoFromSocial, closePlaywrightBrowser } from "../lib/services/playwright-logo";

(async () => {
  const [url, kind] = process.argv.slice(2);
  if (!url || (kind !== "facebook" && kind !== "instagram")) {
    console.error("Usage: npx tsx scripts/smoke-playwright-logo.ts <url> <facebook|instagram>");
    process.exit(2);
  }

  const startMs = Date.now();
  const result = await fetchLogoFromSocial(url, kind);
  const elapsedMs = Date.now() - startMs;

  console.log(`URL:      ${url}`);
  console.log(`Kind:     ${kind}`);
  console.log(`Result:   ${result ?? "<null>"}`);
  console.log(`Elapsed:  ${elapsedMs}ms`);

  await closePlaywrightBrowser();
})();
