/**
 * scripts/build-lead.ts — CLI for "Build website on this lead" (stages 2→3→4).
 *
 * Usage:
 *   npm run --prefix web run:lead-build <lead_id>
 *
 * Why a CLI: stage 3 runs Astro's build in the templates/<niche>/ folder,
 * which needs a writable filesystem + 30–90s. Vercel's serverless can't
 * host this. Run from your laptop or a long-lived worker container.
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { buildLead } from "@/lib/pipeline/build-lead";

async function main() {
  const leadId = process.argv[2];
  if (!leadId) {
    console.error("usage: npm run --prefix web run:lead-build <lead_id>");
    process.exit(2);
  }
  const result = await buildLead(leadId);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
