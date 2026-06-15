/**
 * backfill-category-off-niche.ts — Recompute the category_off_niche soft flag
 * on existing leads using the corrected bucket-comparison logic (lib/filters).
 *
 * Why: the old substring matcher false-flagged morphological variants (e.g.
 * niche "roofer" vs category "Roofing contractor"), lighting up a bogus
 * "Category?" badge in the dashboard. The category data itself is fine — only
 * the flag was wrong. This is a FREE Supabase-only update; no paid API calls,
 * no re-scrape.
 *
 * Usage (from web/):
 *   npx tsx scripts/backfill-category-off-niche.ts          # dry-run (no writes)
 *   npx tsx scripts/backfill-category-off-niche.ts --apply  # write the changes
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { getDb } from "@/lib/db";
import { isCategoryOffNiche } from "@/lib/filters";

interface LeadRow {
  id: string;
  batch_id: string | null;
  category: string | null;
  business_name: string | null;
  category_off_niche: boolean | null;
}

function recompute(niche: string, lead: LeadRow): boolean {
  return isCategoryOffNiche(niche, lead.category, lead.business_name);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();

  const { data: batches, error: bErr } = await db.from("batches").select("id,niche");
  if (bErr) throw new Error(bErr.message);
  const nicheByBatch = new Map<string, string>();
  for (const b of (batches ?? []) as { id: string; niche: string | null }[]) {
    if (b.niche) nicheByBatch.set(b.id, b.niche);
  }

  const { data: leads, error: lErr } = await db
    .from("leads")
    .select("id,batch_id,category,business_name,category_off_niche");
  if (lErr) throw new Error(lErr.message);

  const toTrue: string[] = [];
  const toFalse: string[] = [];
  let skippedNoBatchNiche = 0;

  const describe = (niche: string, lead: LeadRow) =>
    `niche=${JSON.stringify(niche)}  ` +
    `cat=${JSON.stringify(lead.category)} name=${JSON.stringify(lead.business_name)}`;
  const trueDetails: string[] = [];
  const falseDetails: string[] = [];

  for (const lead of (leads ?? []) as LeadRow[]) {
    const niche = lead.batch_id ? nicheByBatch.get(lead.batch_id) : undefined;
    if (!niche) {
      skippedNoBatchNiche++;
      continue;
    }
    const next = recompute(niche, lead);
    const prev = lead.category_off_niche === true;
    if (next === prev) continue;
    if (next) {
      toTrue.push(lead.id);
      trueDetails.push(describe(niche, lead));
    } else {
      toFalse.push(lead.id);
      falseDetails.push(describe(niche, lead));
    }
  }

  console.log(`Leads scanned:           ${leads?.length ?? 0}`);
  console.log(`Skipped (no batch niche): ${skippedNoBatchNiche}`);
  console.log(`Flag cleared (true→false): ${toFalse.length}  ← removes bogus "Category?" badges`);
  for (const d of falseDetails) console.log(`   CLEAR  ${d}`);
  console.log(`Flag set     (false→true): ${toTrue.length}`);
  for (const d of trueDetails) console.log(`   FLAG   ${d}`);

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write these changes.");
    return;
  }

  const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  for (const [value, ids] of [
    [false, toFalse],
    [true, toTrue],
  ] as const) {
    for (const ids_ of chunk(ids, 200)) {
      if (!ids_.length) continue;
      const { error } = await db
        .from("leads")
        .update({ category_off_niche: value })
        .in("id", ids_);
      if (error) throw new Error(`update(${value}) failed: ${error.message}`);
    }
  }

  console.log(`\nApplied. Cleared ${toFalse.length}, set ${toTrue.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
