/**
 * list-deployed.ts — Print every lead that has a deployed demo_url.
 *
 * Usage:
 *   NODE_PATH=web/node_modules npx tsx skills/site-auditor/scripts/list-deployed.ts
 *
 * Emits JSON lines (one row per lead) so the caller can iterate easily.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..", "..");
loadEnv({ path: path.join(REPO_ROOT, ".env") });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data, error } = await db
    .from("leads")
    .select("id, business_name, category, demo_url, stage, brand_color, updated_at")
    .not("demo_url", "is", null)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("supabase error:", error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
