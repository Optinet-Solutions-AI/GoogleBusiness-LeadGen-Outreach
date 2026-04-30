/**
 * scripts/fix-batch-template.ts — One-off: migrate live batches off dead
 * template_slugs ('professional-services' / 'food-beverage' / etc — slugs
 * that have no on-disk template) onto 'premium-trades'.
 *
 * Read-only by default. Pass --apply to actually update.
 *
 * Usage:
 *   npm run --prefix web run:fix-batch-template
 *   npm run --prefix web run:fix-batch-template -- --apply
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

const VALID_SLUGS = new Set(["trades", "premium-trades"]);
const TARGET = "premium-trades";

interface DbBatch {
  id: string;
  niche: string;
  city: string;
  template_slug: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { getDb } = await import("@/lib/db");
  const db = getDb();

  const { data } = await db
    .from("batches")
    .select("id,niche,city,template_slug")
    .order("created_at", { ascending: false });
  const batches = (data ?? []) as DbBatch[];
  const dead = batches.filter((b) => !VALID_SLUGS.has(b.template_slug));

  console.log(`\nTotal batches: ${batches.length}`);
  console.log(`Locked to a missing template_slug: ${dead.length}\n`);
  for (const b of dead) {
    console.log(
      `  ${b.id.slice(0, 8)}  ${b.template_slug.padEnd(22)} → ${TARGET}    ${b.niche} / ${b.city}`,
    );
  }

  if (!dead.length) {
    console.log("Nothing to do.");
    return;
  }

  if (!apply) {
    console.log("\nDRY RUN — re-run with --apply to update.\n");
    return;
  }

  const ids = dead.map((b) => b.id);
  const { error } = await db
    .from("batches")
    .update({ template_slug: TARGET })
    .in("id", ids);
  if (error) throw new Error(`update.error: ${error.message}`);
  console.log(`\n✓ Updated ${ids.length} batch(es) to template_slug='${TARGET}'.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
