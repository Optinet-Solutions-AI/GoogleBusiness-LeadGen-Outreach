/**
 * regen-3.ts — Sequential regenerate of all 3 deployed leads, from
 * `generate` stage (skip enrich since logos/colors are already good).
 * stage-3's photo-cache auto-invalidation will trigger when it sees
 * foreign-niche photos in photo_order_json.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });
import { createClient } from "@supabase/supabase-js";

const API = "https://google-business-lead-gen-outreach.vercel.app/api/leads";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const LEADS = [
  { id: "e9fc7566-a0e5-48da-bd1e-a0aee99efc61", name: "Little Things" },
  { id: "ef23ced4-7a65-46d7-9e4a-f39db036f3dc", name: "Estate Sales"  },
  { id: "3cec5e84-22d8-4b6f-8ac9-919bf4c3837b", name: "Mimi and Me"   },
];

async function waitForRebuild(id: string, name: string, baselineDemo: string | null) {
  const start = Date.now();
  const MAX_MS = 12 * 60 * 1000;
  while (Date.now() - start < MAX_MS) {
    const { data, error } = await db.from("leads").select("demo_url, last_error, variants, photo_order_json").eq("id", id).single();
    if (error) { console.log(`  ${name}: ERROR ${error.message}`); return; }
    if (data?.last_error) { console.log(`  ${name}: ERROR ${data.last_error}`); return; }
    if (data?.demo_url && data.demo_url !== baselineDemo) {
      console.log(`  ${name}: NEW DEMO ${data.demo_url}`);
      console.log(`  ${name}: variants =`, JSON.stringify(data.variants));
      const photos = data.photo_order_json as string[] | null;
      console.log(`  ${name}: photo IDs =`, photos?.map((u) => u.match(/photo-([a-z0-9]+)/)?.[1] ?? "?").slice(0, 6));
      return;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`  ${name}: waiting (${elapsed}s)`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  console.log(`  ${name}: timeout (>12 min)`);
}

for (const { id, name } of LEADS) {
  console.log(`\n=== ${name} ===`);
  const { data: row } = await db.from("leads").select("demo_url").eq("id", id).single();
  const baseline = row?.demo_url ?? null;
  console.log(`  baseline: ${baseline}`);
  const res = await fetch(`${API}/${id}/regenerate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from_stage: "generate" }),
  });
  const body = await res.text();
  console.log(`  trigger: HTTP ${res.status}  ${body.slice(0, 100)}`);
  if (!res.ok) continue;
  await waitForRebuild(id, name, baseline);
}
console.log("\nDONE");
