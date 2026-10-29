/**
 * scripts/flag-wrong-country.ts — reject saved leads whose address is in another country than their batch.
 *
 * Inputs:  leads in non-US batches (address, country_code) — or every batch with --all
 * Outputs: dry run (default) prints them; --apply sets qualified=false, rejection_reason='wrong_country: <cc>'
 * Used by: operator, once, to clean leads scraped before the country fix was deployed
 *
 * Usage (from web/):  npx tsx --tsconfig tsconfig.json scripts/flag-wrong-country.ts [--apply] [--all]
 * Outreach is already refused for these leads by lib/suppression.ts; this makes them show as rejected too.
 * Reversible: the printed ids can be set back to qualified=true.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

async function main() {
  const { getDb } = await import("@/lib/db");
  const { addressCountry, isWrongCountryLead } = await import("@/lib/geo-check");
  const apply = process.argv.includes("--apply");
  const all = process.argv.includes("--all");
  const db = getDb();

  let q = db.from("batches").select("id,niche,city,country_code");
  if (!all) q = q.neq("country_code", "us");
  const { data: batches, error } = await q;
  if (error) throw new Error(error.message);

  const flagged: { id: string; name: string; address: string; cc: string; got: string; contacted: boolean }[] = [];
  for (const b of batches ?? []) {
    const { data: leads, error: lErr } = await db
      .from("leads")
      .select("id,business_name,address,country_code,qualified,seq_status,stage")
      .eq("batch_id", b.id)
      .eq("qualified", true);
    if (lErr) throw new Error(`leads read failed: ${lErr.message}`);
    for (const l of leads ?? []) {
      if (!isWrongCountryLead(l)) continue;
      flagged.push({
        id: l.id,
        name: l.business_name,
        address: l.address ?? "",
        cc: l.country_code ?? "",
        got: addressCountry(l.address) ?? "?",
        contacted: l.stage === "outreached" || (l.seq_status != null && l.seq_status !== "none"),
      });
    }
  }

  for (const f of flagged) {
    console.log(`${f.contacted ? "CONTACTED " : ""}${f.cc}→${f.got}  ${f.name}  |  ${f.address}  |  ${f.id}`);
  }
  console.log(`\n${flagged.length} wrong-country lead(s)${apply ? "" : " (dry run — pass --apply to reject them)"}`);
  if (!apply || !flagged.length) return;

  for (const f of flagged) {
    const { error: e } = await db
      .from("leads")
      .update({ qualified: false, rejection_reason: `wrong_country: ${f.got}` })
      .eq("id", f.id);
    if (e) console.error(`failed ${f.id}: ${e.message}`);
  }
  console.log(`rejected ${flagged.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
