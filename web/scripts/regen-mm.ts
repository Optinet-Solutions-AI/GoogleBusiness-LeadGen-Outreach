/**
 * regen-mm.ts — Regenerate only the Mimi and Me lead, then wait for the
 * new Cloudflare Pages deploy URL.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });
import { createClient } from "@supabase/supabase-js";

const API = "https://google-business-lead-gen-outreach.vercel.app/api/leads";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const LEAD = { id: "3cec5e84-22d8-4b6f-8ac9-919bf4c3837b", name: "Mimi and Me" };

async function main() {
  const { data: row } = await db.from("leads").select("demo_url").eq("id", LEAD.id).single();
  const baseline = row?.demo_url ?? null;
  console.log(`baseline: ${baseline}`);
  const res = await fetch(`${API}/${LEAD.id}/regenerate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from_stage: "generate" }),
  });
  console.log(`trigger: HTTP ${res.status}  ${(await res.text()).slice(0, 100)}`);
  if (!res.ok) return;

  const start = Date.now();
  const MAX_MS = 12 * 60 * 1000;
  while (Date.now() - start < MAX_MS) {
    const { data, error } = await db
      .from("leads")
      .select("demo_url, last_error, variants")
      .eq("id", LEAD.id)
      .single();
    if (error) { console.log(`ERROR ${error.message}`); return; }
    if (data?.last_error) { console.log(`ERROR ${data.last_error}`); return; }
    if (data?.demo_url && data.demo_url !== baseline) {
      console.log(`NEW DEMO ${data.demo_url}`);
      console.log("variants =", JSON.stringify(data.variants));
      return;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`waiting (${elapsed}s)`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
  console.log("timeout (>12 min)");
}
main().catch((e) => { console.error(e); process.exit(1); });
