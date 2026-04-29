/**
 * api/batches/[id]/run/route.ts — Trigger stage 1 (scrape) for a batch.
 *
 * POST /api/batches/:id/run
 *   → AWAITS the scrape, returns counts (`scraped`, `rejected`) when done.
 *
 * Why awaited (not fire-and-forget): on Vercel's serverless platform,
 * functions can be killed after responding. A fire-and-forget Promise
 * dies with the worker. Awaiting keeps the connection open until stage 1
 * completes (~5–30s for limit=60), within Vercel's default 60s timeout.
 *
 * For batches that take longer than 60s (>500 leads) or for production
 * reliability, run from the CLI: `npm run --prefix web run:batch <id>`.
 */

import { runBatch } from "@/lib/pipeline/orchestrator";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const counters = await runBatch(params.id);
  return ok({ id: params.id, status: "done", ...counters });
});

// Allow long-running execution on Vercel (default 10s on Hobby, this raises
// to 60s — same as the platform max for non-Pro accounts; Pro = up to 300s).
export const maxDuration = 60;
