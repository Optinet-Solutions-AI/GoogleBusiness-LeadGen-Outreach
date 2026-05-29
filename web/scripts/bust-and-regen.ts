/**
 * bust-and-regen.ts — Clear photo cache columns for LT, then sequentially
 * regenerate LT then MM so each gets a fresh photo selection + variant
 * pass under the new code.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });
import { createClient } from "@supabase/supabase-js";

const API = "https://google-business-lead-gen-outreach.vercel.app/api/leads";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const LEADS = [
  { id: "e9fc7566-a0e5-48da-bd1e-a0aee99efc61", name: "Little Things", bustCache: true },
  { id: "3cec5e84-22d8-4b6f-8ac9-919bf4c3837b", name: "Mimi and Me",   bustCache: false },
];

async function regen(lead: typeof LEADS[number]) {
  console.log(`\n=== ${lead.name} ===`);

  if (lead.bustCache) {
    const { error } = await db
      .from("leads")
      .update({ hero_photo_url: null, photo_order_json: null, photos_picked_at: null })
      .eq("id", lead.id);
    console.log(`  photo cache cleared: ${error ? `ERR ${error.message}` : "ok"}`);
  }

  const { data: row } = await db.from("leads").select("demo_url").eq("id", lead.id).single();
  const baseline = row?.demo_url ?? null;
  console.log(`  baseline: ${baseline}`);
  const res = await fetch(`${API}/${lead.id}/regenerate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from_stage: "generate" }),
  });
  console.log(`  trigger: HTTP ${res.status}  ${(await res.text()).slice(0, 90)}`);
  if (!res.ok) return;

  const start = Date.now();
  const MAX_MS = 12 * 60 * 1000;
  while (Date.now() - start < MAX_MS) {
    const { data, error } = await db
      .from("leads")
      .select("demo_url, last_error, variants, hero_photo_url")
      .eq("id", lead.id)
      .single();
    if (error) { console.log(`  ERROR ${error.message}`); return; }
    if (data?.last_error) { console.log(`  ERROR ${data.last_error}`); return; }
    if (data?.demo_url && data.demo_url !== baseline) {
      console.log(`  NEW DEMO ${data.demo_url}`);
      console.log("  variants =", JSON.stringify(data.variants));
      const hero = data.hero_photo_url as string | null;
      const heroSource = hero?.includes("unsplash.com") ? "STOCK (unsplash)" : "REAL (google places)";
      console.log(`  hero: ${heroSource}`);
      console.log(`  hero url: ${hero}`);
      return;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`  waiting (${elapsed}s)`);
    await new Promise((r) => setTimeout(r, 25_000));
  }
  console.log("  timeout (>12 min)");
}

async function main() {
  for (const lead of LEADS) await regen(lead);
  console.log("\nDONE");
}
main().catch((e) => { console.error(e); process.exit(1); });
