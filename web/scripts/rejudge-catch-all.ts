/**
 * rejudge-catch-all.ts — Hunter second-opinion pass over leads already marked
 * `catch-all`. Hunter-only (no ZeroBounce spend) and one-directional: only
 * UPGRADES a catch-all to valid/invalid on explicit Hunter proof; a catch-all
 * Hunter can't resolve (or webmail / rate-capped) is left untouched. Safe to
 * re-run after wiring a new verifier.
 *
 * Inputs:  leads with verification_status='catch-all' and a non-null email
 * Outputs: updates verification_status / email_verified / verify_hunter_result / verified_at
 * Used by: operator — npm run --prefix web rejudge:catch-all -- [--limit=200]
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { getDb } from "@/lib/db";
import { verifyHunter } from "@/lib/services/email-validator/email-verifier.hunter";
import { getLogger } from "@/lib/logger";

const log = getLogger("rejudge-catch-all");

async function main() {
  const limit = Number(
    process.argv.slice(2).find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 200,
  );
  const db = getDb();
  const { data } = await db
    .from("leads")
    .select("id,email")
    .eq("verification_status", "catch-all")
    .not("email", "is", null)
    .neq("email", "")
    .limit(limit);
  const leads = (data ?? []) as { id: string; email: string | null }[];

  const summary = { checked: 0, upgraded_valid: 0, upgraded_invalid: 0, kept_catch_all: 0, skipped: 0 };
  for (const lead of leads) {
    if (!lead.email) { summary.skipped++; continue; }
    const r = await verifyHunter(lead.email).catch(() => null);
    summary.checked++;
    if (!r) { summary.skipped++; continue; } // webmail / rate-capped / no key
    if (r.status === "valid" || r.status === "invalid") {
      await db.from("leads").update({
        verification_status: r.status,
        email_verified: r.status === "valid",
        verify_hunter_result: r.raw,
        verified_at: new Date().toISOString(),
      }).eq("id", lead.id);
      if (r.status === "valid") summary.upgraded_valid++; else summary.upgraded_invalid++;
    } else {
      // Hunter also can't resolve it (accept_all / unknown) — keep catch-all,
      // just record the audit trail. Never downgrade a sendable catch-all.
      await db.from("leads").update({ verify_hunter_result: r.raw }).eq("id", lead.id);
      summary.kept_catch_all++;
    }
    log.info({ email: lead.email, hunter: r.raw, status: r.status }, "rejudge.done");
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
