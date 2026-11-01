/**
 * scripts/backfill-emails.ts — Re-crawl contact details (email, phone, contact page) for existing has-website leads.
 *
 * Targets leads with website_kind='real' and email IS NULL (e.g. scraped before the email crawl
 * existed, or via Places/Outscraper which don't return emails). Free — uses website-email.ts
 * (plain fetch + the site's own contact/about pages + Playwright render fallback). Writes leads.email, a missing
 * leads.phone and leads.contact_page_url (migration 052), and reports coverage. --batch=<id> limits it to one batch.
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
  const { findWebsiteContacts } = await import("@/lib/services/website-email");
  const { closePlaywrightBrowser } = await import("@/lib/services/headless-browser");
  const dryRun = process.argv.includes("--dry-run");
  const batchId = process.argv.find((a) => a.startsWith("--batch="))?.slice("--batch=".length) ?? null;
  const db = getDb();

  let q = db
    .from("leads")
    .select("id,business_name,website_url,country_code,phone")
    .eq("website_kind", "real")
    .is("email", null)
    .not("website_url", "is", null);
  if (batchId) q = q.eq("batch_id", batchId);
  const { data: leads, error } = await q.limit(300);
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
        const c = await findWebsiteContacts(l.website_url as string, l.country_code as string | null);
        const patch: Record<string, string> = {};
        if (c.email) patch.email = c.email;
        if (!l.phone && c.phone) patch.phone = c.phone;
        if (c.contact_url) patch.contact_page_url = c.contact_url;
        if (Object.keys(patch).length) {
          let { error: uErr } = await db.from("leads").update(patch).eq("id", l.id);
          if (uErr && /contact_page_url/.test(uErr.message)) {
            delete patch.contact_page_url; // migration 052 not applied yet
            ({ error: uErr } = await db.from("leads").update(patch).eq("id", l.id));
          }
          if (uErr) throw new Error(uErr.message);
        }
        if (c.email) hits += 1;
        console.log(`  ${c.email ? "✓" : "·"} ${l.business_name} → ${c.email ?? "(no email)"}${c.contact_url ? `  | ${c.contact_url}` : ""}`);
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
