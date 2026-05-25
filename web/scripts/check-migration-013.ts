/**
 * check-migration-013.ts — Probe Supabase for the photo-cache columns.
 *
 * Run with: npx tsx scripts/check-migration-013.ts  (from web/)
 *
 * Exits 0 if the columns exist (returns 1 row, possibly with all NULLs),
 * 1 if the migration hasn't been applied (PGRST error mentions undefined column).
 * One-off verification — safe to delete after the migration is confirmed live.
 */
import { getDb } from "../lib/db";

(async () => {
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .select("id, business_name, hero_photo_url, photo_order_json, photos_picked_at")
    .limit(1);
  if (error) {
    console.error("MIGRATION NOT APPLIED:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log("Migration 013 is live (no leads in DB yet to project against).");
    return;
  }
  const row = data[0];
  console.log("Migration 013 is live. Sample row:");
  console.log(`  id:                ${row.id}`);
  console.log(`  business_name:     ${row.business_name}`);
  console.log(`  hero_photo_url:    ${row.hero_photo_url ?? "<null>"}`);
  console.log(`  photo_order_json:  ${row.photo_order_json ? "[" + (row.photo_order_json as unknown[]).length + " photos]" : "<null>"}`);
  console.log(`  photos_picked_at:  ${row.photos_picked_at ?? "<null>"}`);
})();
