/**
 * lookup-lead.ts — Resolve a UUID or business-name fragment to a lead row.
 *
 * Usage:
 *   npx tsx skills/site-auditor/scripts/lookup-lead.ts <uuid-or-name>
 *
 * Prints JSON: { id, business_name, demo_url, logo_url, brand_color, stage }
 * or exits non-zero if no match. Soft-handles ambiguous name matches by
 * picking the most recently updated lead.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

loadEnv({ path: path.join(REPO_ROOT, ".env") });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: lookup-lead <uuid-or-name-fragment>");
    process.exit(2);
  }

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SELECT = "id, business_name, demo_url, logo_url, brand_color, stage, updated_at";

  const { data, error } = UUID_RE.test(arg)
    ? await db.from("leads").select(SELECT).eq("id", arg).maybeSingle()
    : await db
        .from("leads")
        .select(SELECT)
        .ilike("business_name", `%${arg}%`)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  if (error) {
    console.error("supabase error:", error.message);
    process.exit(1);
  }
  if (!data) {
    console.error("no lead matched:", arg);
    process.exit(1);
  }

  // Truncate logo_url so the JSON stays readable on a terminal.
  const safe = {
    ...data,
    logo_url: data.logo_url
      ? `${(data.logo_url as string).slice(0, 50)}...(${(data.logo_url as string).length}b)`
      : null,
  };
  console.log(JSON.stringify(safe, null, 2));
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
