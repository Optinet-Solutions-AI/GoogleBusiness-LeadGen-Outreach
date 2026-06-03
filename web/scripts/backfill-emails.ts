/**
 * scripts/backfill-emails.ts — Re-crawl contact emails for existing has-website leads.
 *
 * Targets leads with website_kind='real' and email IS NULL (e.g. scraped before the email crawl
 * existed, or via Places/Outscraper which don't return emails). Free — uses website-email.ts
 * (plain fetch + Playwright render fallback). Writes leads.email and reports coverage.
 *
 * Usage (from web/):
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-emails.ts            (executes)
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-emails.ts --dry-run  (counts only)
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

const CONCURRENCY = 4;

async function main() {
  const { getDb } = await import("@/lib/db");
  const { findWebsiteEmail } = await import("@/lib/services/website-email");
  const { closePlaywrightBrowser } = await import("@/lib/services/headless-browser");
  const dryRun = process.argv.includes("--dry-run");
  const db = getDb();

  const { data: leads, error } = await db
    .from("leads")
    .select("id,business_name,website_url,country_code")
    .eq("website_kind", "real")
    .is("email", null)
    .not("website_url", "is", null)
    .limit(300);
  if (error) throw new Error(error.message);
  if (!leads?.length) {
    console.log("No real-website leads missing an email — nothing to do.");
    return;
  }

  console.log(`\n${leads.length} real-website leads missing an email.`);
  if (dryRun) {
    console.log("DRY RUN — no crawls, no writes.");
    return;
  }
  console.log("Crawling for contact emails...\n");

  const queue = [...leads];
  let hits = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const l = queue.shift();
      if (!l) break;
      try {
        const email = await findWebsiteEmail(l.website_url as string, l.country_code as string | null);
        if (email) {
          await db.from("leads").update({ email }).eq("id", l.id);
          hits += 1;
          console.log(`  ✓ ${l.business_name} → ${email}`);
        } else {
          console.log(`  · ${l.business_name} → (none)`);
        }
      } catch (e) {
        console.log(`  ✗ ${l.business_name} — ${String(e).slice(0, 80)}`);
      }
    }
  });
  await Promise.all(workers);
  await closePlaywrightBrowser().catch(() => {});

  console.log(`\nDone. ${hits}/${leads.length} now have an email (${Math.round((100 * hits) / leads.length)}%).\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
