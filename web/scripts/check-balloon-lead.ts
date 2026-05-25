/**
 * Diagnostic for "The Little Things | Balloon Garlands".
 */
import { getDb } from "../lib/db";
import { classifyNiche } from "../lib/niche";

(async () => {
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .select(
      "id, business_name, category, photos, hero_photo_url, photo_order_json, photos_picked_at, updated_at, demo_url, last_error, rebuild_started_at",
    )
    .ilike("business_name", "%Little Things%");

  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log("No 'Little Things' lead found.");
    return;
  }

  for (const lead of data) {
    const niche = classifyNiche(lead.category, lead.business_name);
    console.log(`\n--- ${lead.business_name} (${lead.id}) ---`);
    console.log(`  category:           ${lead.category}`);
    console.log(`  classified niche:   ${niche}`);
    console.log(`  photos (raw):       ${Array.isArray(lead.photos) ? lead.photos.length + " entries" : "<null>"}`);
    console.log(`  demo_url:           ${lead.demo_url}`);
    console.log(`  hero_photo_url:     ${lead.hero_photo_url ?? "<null>"}`);
    console.log(`  photo_order_json:   ${lead.photo_order_json ? "[" + (lead.photo_order_json as unknown[]).length + " entries]" : "<null>"}`);
    console.log(`  photos_picked_at:   ${lead.photos_picked_at ?? "<null>"}`);
    console.log(`  rebuild_started_at: ${lead.rebuild_started_at ?? "<null>"}`);
    console.log(`  last_error:         ${lead.last_error ?? "<null>"}`);
    console.log(`  updated_at:         ${lead.updated_at}`);
    if (lead.photo_order_json) {
      const photos = lead.photo_order_json as string[];
      photos.slice(0, 4).forEach((url, i) => console.log(`    photo[${i}]: ${url.slice(0, 100)}`));
    }
  }
})();
