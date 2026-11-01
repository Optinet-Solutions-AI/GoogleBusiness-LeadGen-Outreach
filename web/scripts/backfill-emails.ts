/**
 * scripts/backfill-emails.ts — Re-crawl contact details (email, phone, contact page) for existing has-website leads.
 *
 * Targets leads with website_kind='real' and email IS NULL (e.g. scraped before the email crawl
 * existed, or via Places/Outscraper which don't return emails). Free — uses website-email.ts
 * (plain fetch + the site's own contact/about pages + Playwright render fallback). Writes leads.email, a missing
 * leads.phone and leads.contact_page_url (migration 052), and reports coverage. --batch=<id> limits it to one batch.
 * --ai also asks OpenAI web search (paid, ~1-3 cents a lead, at most --max-ai=N, default 50) for leads the crawl
 * left without an email, and saves the owner name/role + sources (migration 053).
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
  const { findContactsWithAI, isAiContactsConfigured } = await import("@/lib/services/openai-contacts");
  const { closePlaywrightBrowser } = await import("@/lib/services/headless-browser");
  const dryRun = process.argv.includes("--dry-run");
  const batchId = process.argv.find((a) => a.startsWith("--batch="))?.slice("--batch=".length) ?? null;
  const useAi = process.argv.includes("--ai");
  let aiLeft = Number(process.argv.find((a) => a.startsWith("--max-ai="))?.slice("--max-ai=".length) ?? 50);
  let aiUsd = 0;
  if (useAi && !isAiContactsConfigured()) throw new Error("--ai needs OPENAI_API_KEY in .env");
  const db = getDb();

  let q = db
    .from("leads")
    .select("id,business_name,website_url,country_code,phone,address")
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
        const patch: Record<string, unknown> = {};
        if (c.email) patch.email = c.email;
        if (!l.phone && c.phone) patch.phone = c.phone;
        if (c.contact_url) patch.contact_page_url = c.contact_url;
        let owner = "";
        if (!c.email && useAi && aiLeft > 0) {
          aiLeft -= 1;
          try {
            const a = await findContactsWithAI({
              business_name: l.business_name as string,
              website_url: l.website_url as string,
              address: (l.address as string | null) ?? null,
              country_code: l.country_code as string | null,
            });
            aiUsd += a.usd;
            if (a.email) {
              patch.email = a.email;
              c.email = a.email;
            }
            if (!l.phone && !patch.phone && a.phone) patch.phone = a.phone;
            if (!patch.contact_page_url && a.contact_url) patch.contact_page_url = a.contact_url;
            if (a.owner_name) {
              patch.contact_owner_name = a.owner_name;
              patch.contact_owner_role = a.owner_role;
              owner = ` | owner: ${a.owner_name}${a.owner_role ? ` (${a.owner_role})` : ""}`;
            }
            if (a.sources.length) patch.contact_sources = a.sources;
          } catch (e) {
            if (/ 429|insufficient_quota|401/.test(String(e))) aiLeft = 0;
            console.log(`  ! AI lookup failed for ${l.business_name}: ${String(e).slice(0, 100)}`);
          }
        }
        if (Object.keys(patch).length) {
          let { error: uErr } = await db.from("leads").update(patch).eq("id", l.id);
          if (uErr && /contact_(page_url|owner|sources)/.test(uErr.message)) {
            for (const k of ["contact_page_url", "contact_owner_name", "contact_owner_role", "contact_sources"]) delete patch[k]; // migration 052/053 not applied
            ({ error: uErr } = await db.from("leads").update(patch).eq("id", l.id));
          }
          if (uErr) throw new Error(uErr.message);
        }
        if (c.email) hits += 1;
        console.log(`  ${c.email ? "✓" : "·"} ${l.business_name} → ${c.email ?? "(no email)"}${patch.contact_page_url ? `  | ${String(patch.contact_page_url)}` : ""}${owner}`);
      } catch (e) {
        console.log(`  ✗ ${l.business_name} — ${String(e).slice(0, 80)}`);
      }
    }
  });
  await Promise.all(workers);
  await closePlaywrightBrowser().catch(() => {});

  console.log(`\nDone. ${hits}/${leads.length} now have an email (${Math.round((100 * hits) / leads.length)}%).${useAi ? ` AI spend about $${aiUsd.toFixed(3)}.` : ""}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
