/**
 * regen-es.ts — Bust Estate Sales' photo cache + regen so the fixed
 * Vision-failure-fallback path (post-588b0c0) picks real photos.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });
import { createClient } from "@supabase/supabase-js";

const API = "https://google-business-lead-gen-outreach.vercel.app/api/leads";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const ID = "ef23ced4-7a65-46d7-9e4a-f39db036f3dc";

async function main() {
  const { error: clearErr } = await db
    .from("leads")
    .update({ hero_photo_url: null, photo_order_json: null, photos_picked_at: null })
    .eq("id", ID);
  console.log(`photo cache cleared: ${clearErr ? clearErr.message : "ok"}`);

  const { data: row } = await db.from("leads").select("demo_url").eq("id", ID).single();
  const baseline = row?.demo_url ?? null;
  console.log(`baseline: ${baseline}`);

  const res = await fetch(`${API}/${ID}/regenerate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from_stage: "generate" }),
  });
  console.log(`trigger: HTTP ${res.status}  ${(await res.text()).slice(0, 90)}`);
  if (!res.ok) return;

  const start = Date.now();
  while (Date.now() - start < 12 * 60_000) {
    const { data } = await db
      .from("leads")
      .select("demo_url, hero_photo_url, variants, last_error")
      .eq("id", ID)
      .single();
    if (data?.last_error) { console.log(`ERROR ${data.last_error}`); return; }
    if (data?.demo_url && data.demo_url !== baseline) {
      console.log(`NEW DEMO ${data.demo_url}`);
      const hero = data.hero_photo_url as string | null;
      console.log(`hero: ${hero?.includes("unsplash.com") ? "STOCK" : "REAL"}`);
      console.log(`hero url: ${hero}`);
      return;
    }
    console.log(`waiting (${Math.round((Date.now() - start) / 1000)}s)`);
    await new Promise(r => setTimeout(r, 25_000));
  }
  console.log("timeout");
}
main().catch(e => { console.error(e); process.exit(1); });
