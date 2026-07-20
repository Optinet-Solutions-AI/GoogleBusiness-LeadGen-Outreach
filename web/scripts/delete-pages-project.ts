/** delete-pages-project.ts — delete a Cloudflare Pages project (takes the demo offline).
 *
 * Also clears the matching lead's demo_url / screenshot so the dashboard stops
 * showing a "View site" link that 404s ("cannot be found"). Without this, a
 * deleted project leaves a dangling demo_url on the lead row. */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
import { env } from "@/lib/config";
import { getDb } from "@/lib/db";

const SLUG = process.argv[2] ?? "alexanders-auto-repair";
const API = "https://api.cloudflare.com/client/v4";

async function main() {
  const acct = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!acct || !token) throw new Error("Cloudflare creds missing");
  const url = `${API}/accounts/${acct}/pages/projects/${SLUG}`;
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  console.log(`DELETE ${SLUG} → HTTP ${res.status}`);
  console.log(await res.text());

  // Clear the dangling demo on any lead pointing at this now-deleted project so
  // the dashboard shows "not built" (with a Build button) instead of a dead link.
  // Reset stage to 'enriched' so the lead is cleanly re-buildable.
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .update({ demo_url: null, screenshot_url: null, screenshot_captured_at: null, stage: "enriched" })
    .ilike("demo_url", `%${SLUG}.pages.dev%`)
    .select("id,business_name");
  if (error) console.log("lead cleanup error:", error.message);
  else console.log(`cleared demo_url on ${data?.length ?? 0} lead(s):`, (data ?? []).map((r: any) => r.business_name).join(", ") || "none");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
