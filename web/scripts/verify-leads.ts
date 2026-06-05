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

import { verifyUnverifiedLeads } from "@/lib/verify/verify-lead";

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 500);
  const smtpEnabled = args.includes("--smtp");
  const summary = await verifyUnverifiedLeads(limit, { smtpEnabled });
  console.log(JSON.stringify(summary, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
