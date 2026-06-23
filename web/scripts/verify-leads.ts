/**
 * verify-leads.ts — CLI batch email verification.
 *
 * Inputs:  leads rows with an email and email_verified = false
 * Outputs: updates leads.verification_status + leads.email_verified (+ audit cols) in DB
 * Used by: operator, npm run verify:leads
 *
 * Usage: npm run --prefix web verify:leads -- [--limit=500] [--smtp]
 * Pass --smtp on a host with port 25 open to enable the free RCPT/catch-all probe.
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 500);
  const smtpEnabled = args.includes("--smtp");
  // Dynamic import AFTER loadEnv() above — a static import is hoisted and would
  // parse lib/config.ts (and freeze the verifier API keys to "") before dotenv
  // populates process.env. Mirrors scripts/backfill-emails.ts.
  const { verifyUnverifiedLeads } = await import("@/lib/verify/verify-lead");
  const summary = await verifyUnverifiedLeads(limit, { smtpEnabled });
  console.log(JSON.stringify(summary, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
