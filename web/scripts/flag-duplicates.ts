/**
 * flag-duplicates.ts — detect duplicate leads and FLAG them (never delete).
 *
 * Inputs:  leads (email / business_name / address + completeness signals)
 * Outputs: sets leads.is_duplicate + leads.duplicate_of on the non-primary rows
 * Used by: operator — npm run --prefix web flag:duplicates  (requires migration 031)
 *
 * Two grouping keys: same normalised email, or (no email) same business+address.
 * Within a group the most-complete row is kept as the primary; the rest are
 * flagged duplicate_of=<primary>. "Detect, don't auto-reject" — the operator
 * still decides per-lead; this only marks + links them.
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const log = getLogger("flag-duplicates");
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

interface Row {
  id: string;
  business_name: string | null;
  email: string | null;
  address: string | null;
  verification_status: string | null;
  demo_url: string | null;
  has_website: boolean | null;
  created_at: string;
}

/** Higher = keep as primary. Prefer a real verdict, a built site, an email, then newest. */
function score(r: Row): number {
  const v = r.verification_status;
  return (
    (v === "valid" ? 4 : v === "catch-all" ? 3 : v === "invalid" ? 1 : 0) +
    (r.demo_url ? 2 : 0) +
    (r.email && r.email.trim() ? 1 : 0) +
    (r.has_website ? 0.5 : 0)
  );
}

function pickPrimary(group: Row[]): Row {
  return [...group].sort((a, b) => score(b) - score(a) || (b.created_at > a.created_at ? 1 : -1))[0];
}

async function main() {
  const apply = !process.argv.includes("--dry-run");
  const db = getDb();
  const { data } = await db
    .from("leads")
    .select("id,business_name,email,address,verification_status,demo_url,has_website,created_at");
  const rows = (data ?? []) as Row[];

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = norm(r.email) ? `e:${norm(r.email)}` : norm(r.business_name) ? `b:${norm(r.business_name)}|${norm(r.address)}` : "";
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  let groupsWithDupes = 0;
  let flagged = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    groupsWithDupes++;
    const primary = pickPrimary(group);
    for (const r of group) {
      if (r.id === primary.id) continue;
      flagged++;
      if (apply) {
        await db.from("leads").update({ is_duplicate: true, duplicate_of: primary.id }).eq("id", r.id);
      }
    }
  }
  const summary = { groupsWithDupes, flagged, applied: apply };
  log.info(summary, "flag-duplicates.done");
  console.log(JSON.stringify(summary, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
