/**
 * scripts/inspect-leads.ts — One-off DB inspector.
 *
 * Dumps every batch + lead so we can confirm:
 *   - which leads exist
 *   - their stage / qualified flag (= what the dashboard table renders)
 *   - whether any have stale last_error after a successful deploy
 *
 * Optional: pass --clear-stale-errors to NULL out last_error on rows that
 * already reached stage='deployed' or beyond. Read-only by default.
 *
 * Usage:
 *   npm run --prefix web run:inspect-leads
 *   npm run --prefix web run:inspect-leads -- --clear-stale-errors
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

const POST_DEPLOY_STAGES = new Set([
  "deployed",
  "outreached",
  "needs_email",
  "replied",
  "meeting_booked",
  "meeting_done",
  "improved",
  "handed_over",
  "closed_won",
  "closed_lost",
]);

interface DbBatch {
  id: string;
  niche: string;
  city: string;
  status: string;
  scraped_count: number | null;
  rejected_count: number | null;
  created_at: string;
}

interface DbLead {
  id: string;
  batch_id: string;
  business_name: string;
  stage: string;
  qualified: boolean | null;
  demo_url: string | null;
  last_error: string | null;
  rejection_reason: string | null;
}

async function main() {
  const clearStale = process.argv.includes("--clear-stale-errors");
  const { getDb } = await import("@/lib/db");
  const db = getDb();

  const { data: batches } = await db
    .from("batches")
    .select("id,niche,city,status,scraped_count,rejected_count,created_at")
    .order("created_at", { ascending: false });
  const { data: leads } = await db
    .from("leads")
    .select("id,batch_id,business_name,stage,qualified,demo_url,last_error,rejection_reason");

  if (!batches || !leads) {
    console.log("No data.");
    return;
  }

  const byBatch = new Map<string, DbLead[]>();
  for (const l of leads as DbLead[]) {
    const arr = byBatch.get(l.batch_id) ?? [];
    arr.push(l);
    byBatch.set(l.batch_id, arr);
  }

  let staleErrorRows = 0;
  let staleErrorIds: string[] = [];

  for (const b of batches as DbBatch[]) {
    const ls = byBatch.get(b.id) ?? [];
    const qualified = ls.filter((l) => l.qualified !== false);
    const rejected = ls.filter((l) => l.qualified === false);

    console.log(`\n──────── batch ${b.id.slice(0, 8)} · ${b.niche} / ${b.city}  status=${b.status}`);
    console.log(`  total rows: ${ls.length}    qualified: ${qualified.length}    rejected: ${rejected.length}`);
    console.log("  qualified leads (this is what the dashboard table shows):");
    for (const l of qualified) {
      const stale = l.last_error && POST_DEPLOY_STAGES.has(l.stage);
      const flag = stale ? "  ⚠ STALE_ERROR" : "";
      console.log(
        `    ${l.id.slice(0, 8)}  stage=${l.stage.padEnd(15)}  qualified=${String(l.qualified).padEnd(5)}  demo=${l.demo_url ? "yes" : "—"}  err=${l.last_error ? "yes" : "—"}${flag}  ${l.business_name.slice(0, 40)}`,
      );
      if (stale) {
        staleErrorRows += 1;
        staleErrorIds.push(l.id);
      }
    }
    if (rejected.length) {
      console.log(`  rejected (hidden from main table, shown in 'Rejected leads' panel):`);
      for (const l of rejected) {
        console.log(`    ${l.id.slice(0, 8)}  ${l.rejection_reason ?? "—"}  ${l.business_name.slice(0, 40)}`);
      }
    }
  }

  console.log(`\nStale-error candidates (post-deploy stage but last_error set): ${staleErrorRows}`);
  if (clearStale && staleErrorIds.length) {
    console.log("Clearing...");
    const { error } = await db
      .from("leads")
      .update({ last_error: null })
      .in("id", staleErrorIds);
    if (error) throw new Error(`clear.error: ${error.message}`);
    console.log(`✓ Cleared last_error on ${staleErrorIds.length} rows.\n`);
  } else if (staleErrorRows) {
    console.log("Re-run with --clear-stale-errors to NULL them out.\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
