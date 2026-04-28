/**
 * scripts/run-batch.ts — CLI runner for the 5-stage pipeline.
 *
 * Usage:
 *   npm run --prefix web run:batch -- <batch_id>
 *   npm run --prefix web run:batch -- --niche=plumber --city="Austin, TX" --scraper=google_places --limit=60
 *
 * Why a CLI: the pipeline takes minutes per batch (Astro build, Cloudflare
 * deploys). Serverless function timeouts are short. Run this from a terminal
 * (or a long-lived worker) instead of the Route Handler.
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { createBatch, runBatch } from "@/lib/pipeline/orchestrator";
import type { Scraper } from "@/lib/pricing";

interface Args {
  batchId?: string;
  niche?: string;
  city?: string;
  template?: string;
  scraper?: Scraper;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) {
      out.batchId = arg;
      continue;
    }
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "niche") out.niche = v;
    else if (k === "city") out.city = v;
    else if (k === "template") out.template = v;
    else if (k === "scraper") out.scraper = v as Scraper;
    else if (k === "limit") out.limit = Number(v);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  let id = args.batchId;
  if (!id) {
    if (!args.niche || !args.city) {
      console.error(
        "usage: run:batch <batch_id>\n" +
          "       run:batch --niche=... --city=... [--template=trades] [--scraper=google_places] [--limit=100]",
      );
      process.exit(2);
    }
    const created = await createBatch({
      niche: args.niche,
      city: args.city,
      template_slug: args.template ?? "trades",
      scraper: args.scraper ?? "google_places",
      limit: args.limit ?? 100,
    });
    id = created.id;
    console.log(`created batch ${id} (estimated $${created.estimated_cost_usd.toFixed(2)})`);
  }

  const counters = await runBatch(id);
  console.log(JSON.stringify({ batch_id: id, ...counters }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
