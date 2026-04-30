/**
 * scripts/backfill-enrich.ts — One-off: enrich already-scraped leads.
 *
 * Inputs:  none (reads DB)
 * Outputs: brand_color + stage='enriched' on qualified leads that predate
 *          the stage-1 enrichment migration.
 * Used by: operator (manual run after deploying the new pipeline)
 *
 * Usage:
 *   npm run --prefix web run:backfill-enrich -- --dry-run
 *   npm run --prefix web run:backfill-enrich           (executes)
 *
 * Cost: Places leads cost ~$0.007 per Photo API resolve. Outscraper leads
 * are free (photo URLs already inline). Dry-run reports counts + estimate.
 *
 * Safety:
 *   - Only touches qualified=true rows still at stage='scraped' (the new
 *     stage-1 marks new qualified leads as 'enriched' directly, so this
 *     selects only the legacy backlog).
 *   - Idempotent: the underlying stage-2-enrich short-circuits when
 *     brand_color is already set.
 *   - Concurrency capped at 5 to avoid hammering Places.
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";

// Load .env BEFORE we import anything that reads process.env at module-load
// time (lib/config.ts validates env on import). Without this, getDb() throws
// "SUPABASE_URL / SUPABASE_SERVICE_KEY missing" even when .env is correct.
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

interface DbLead {
  id: string;
  business_name: string;
  batch_id: string;
  brand_color: string | null;
  email: string | null;
  photos: Array<{ name?: string; url?: string }>;
}

interface BatchScraper {
  id: string;
  scraper: "google_places" | "outscraper";
}

const CONCURRENCY = 5;
const PLACES_PHOTO_COST_USD = 0.007;

async function main() {
  const { getDb } = await import("@/lib/db");
  const stage2 = await import("@/lib/pipeline/stage-2-enrich");
  const dryRun = process.argv.includes("--dry-run");
  const db = getDb();

  // 1. Find candidate leads.
  const { data: leads, error } = await db
    .from("leads")
    .select("id,business_name,batch_id,brand_color,email,photos")
    .eq("qualified", true)
    .eq("stage", "scraped");
  if (error) throw new Error(`select.error: ${error.message}`);
  if (!leads || leads.length === 0) {
    console.log("Nothing to do — no qualified leads at stage='scraped'.");
    return;
  }

  // 2. Resolve each lead's batch.scraper so we know what'll cost.
  const batchIds = Array.from(new Set(leads.map((l) => l.batch_id)));
  const { data: batches } = await db
    .from("batches")
    .select("id,scraper")
    .in("id", batchIds);
  const scraperByBatch = new Map<string, BatchScraper["scraper"]>(
    (batches ?? []).map((b) => [b.id, b.scraper as BatchScraper["scraper"]]),
  );

  // 3. Cost estimate.
  const placesCount = leads.filter((l) => scraperByBatch.get(l.batch_id) === "google_places" && !l.brand_color && (l.photos?.length ?? 0) > 0).length;
  const outscraperCount = leads.filter((l) => scraperByBatch.get(l.batch_id) === "outscraper" && !l.brand_color && (l.photos?.length ?? 0) > 0).length;
  const skipCount = leads.length - placesCount - outscraperCount;
  const estCostUsd = placesCount * PLACES_PHOTO_COST_USD;

  console.log("\n──────── backfill plan ────────");
  console.log(`  qualified scraped leads       : ${leads.length}`);
  console.log(`    needs Places photo resolve  : ${placesCount}  ($${estCostUsd.toFixed(2)})`);
  console.log(`    needs Outscraper extraction : ${outscraperCount}  ($0.00 — URLs inline)`);
  console.log(`    no photos / already colored : ${skipCount}  (will just bump stage)`);
  console.log("───────────────────────────────\n");

  if (dryRun) {
    console.log("DRY RUN — no API calls, no DB writes. Re-run without --dry-run to execute.");
    return;
  }

  // 4. Execute with concurrency.
  const queue = [...leads] as DbLead[];
  let done = 0;
  let failed = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const lead = queue.shift();
      if (!lead) break;
      try {
        await stage2.run({
          id: lead.id,
          business_name: lead.business_name,
          brand_color: lead.brand_color,
          email: lead.email,
          photos: lead.photos ?? [],
          batch_id: lead.batch_id,
        });
        done += 1;
        if (done % 10 === 0) console.log(`  ✓ ${done}/${leads.length}`);
      } catch (err) {
        failed += 1;
        console.error(`  ✗ lead=${lead.id} err=${String(err).slice(0, 200)}`);
      }
    }
  });
  await Promise.all(workers);

  console.log(`\nDone. enriched=${done}  failed=${failed}  total=${leads.length}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
