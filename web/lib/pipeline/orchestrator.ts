/**
 * orchestrator.ts — Drives stage 1 (scrape) for a batch. Stages 2–5 are
 * per-lead manual triggers, NOT auto-orchestrated.
 *
 * Inputs:  batchId
 * Outputs: batch.status moves through queued → running → done; leads land
 *          at stage='scraped' awaiting operator review.
 * Used by: scripts/run-batch.ts (CLI), app/api/batches/[id]/run/route.ts
 *
 * Why scrape-only by default:
 *   The operator needs to review scraped leads before paying Gemini quota
 *   + creating live Cloudflare Pages projects + sending cold emails. Each
 *   downstream stage runs only when the operator clicks Build / Send on a
 *   specific lead — see lib/pipeline/build-lead.ts and stage-5-outreach.
 */

import crypto from "node:crypto";
import { getDb } from "../db";
import { getLogger } from "../logger";
import { estimate, type Scraper } from "../pricing";
import * as stage1 from "./stage-1-scrape";

const log = getLogger("orchestrator");

export interface CreateBatchInput {
  niche: string;
  city: string;
  template_slug: string;
  scraper: Scraper;
  limit: number;
  /** ISO 3166-1 alpha-2 (lowercase). Bias for Places/Outscraper region. */
  country_code?: string;
}

export async function createBatch(input: CreateBatchInput): Promise<{
  id: string;
  estimated_cost_usd: number;
}> {
  const id = crypto.randomUUID();
  const est = estimate(input.scraper, input.limit);
  const { error } = await getDb()
    .from("batches")
    .insert({
      id,
      niche: input.niche,
      city: input.city,
      template_slug: input.template_slug,
      scraper: input.scraper,
      country_code: input.country_code ?? "us",
      limit: input.limit,
      status: "queued",
      estimated_cost_usd: est.total_usd,
    });
  if (error) throw new Error(`createBatch.error: ${error.message}`);
  return { id, estimated_cost_usd: est.total_usd };
}

/**
 * Runs stage 1 (scrape) only. Leaves every lead at stage='scraped' for
 * operator review. To advance a lead to a built/deployed website, call
 * `buildLead(leadId)` from build-lead.ts (typically via the dashboard).
 */
export async function runBatch(batchId: string): Promise<{
  scraped: number;
  rejected: number;
}> {
  const db = getDb();
  const { data: batch, error } = await db
    .from("batches")
    .select("*")
    .eq("id", batchId)
    .single();
  if (error || !batch) throw new Error(`batch not found: ${batchId}`);

  await db.from("batches").update({ status: "running" }).eq("id", batchId);
  log.info({ batch_id: batchId, niche: batch.niche, city: batch.city }, "orchestrator.start");

  let result;
  try {
    result = await stage1.run(batch as stage1.Batch);
  } catch (err) {
    await db.from("batches").update({ status: "failed" }).eq("id", batchId);
    log.error({ batch_id: batchId, err: String(err) }, "orchestrator.scrape_failed");
    throw err;
  }

  await db
    .from("batches")
    .update({
      status: "done",
      scraped_count: result.accepted + result.rejected,
      rejected_count: result.rejected,
      rejection_reasons: result.rejection_reasons,
    })
    .eq("id", batchId);
  log.info({ batch_id: batchId, ...result }, "orchestrator.done");
  return { scraped: result.accepted, rejected: result.rejected };
}

export interface QueuedBatchResult {
  batch_id: string;
  status: "done" | "failed" | "skipped";
  scraped?: number;
  rejected?: number;
  error?: string;
}

/**
 * Drain queued batches concurrently (a capped worker pool), instead of one per
 * invocation. Each batch is atomically claimed (queued → running) before it runs
 * so two runners never scrape the same batch twice (double spend). Per-batch
 * failures are isolated — one failed scrape doesn't stop the rest.
 *
 * Scraping is a PAID call, so this only touches batches the operator already
 * queued, caps concurrency (default 3, max 8), and caps how many it pulls
 * (default 25). It logs the summed estimated cost before firing.
 */
export async function runQueuedBatches(opts?: {
  concurrency?: number;
  max?: number;
}): Promise<{ ran: number; results: QueuedBatchResult[] }> {
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 3, 8));
  const max = Math.max(1, opts?.max ?? 25);
  const db = getDb();

  const { data: batches, error } = await db
    .from("batches")
    .select("id,niche,city,estimated_cost_usd")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(max);
  if (error) throw new Error(`runQueuedBatches.query: ${error.message}`);

  const queue = [...(batches ?? [])] as { id: string; estimated_cost_usd: number | null }[];
  if (queue.length === 0) {
    log.info("runQueuedBatches.empty (no queued batches)");
    return { ran: 0, results: [] };
  }
  const estTotal = queue.reduce((s, b) => s + (Number(b.estimated_cost_usd) || 0), 0);
  log.info(
    { count: queue.length, concurrency, est_total_usd: Number(estTotal.toFixed(2)) },
    "runQueuedBatches.start",
  );

  const results: QueuedBatchResult[] = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const b = queue.shift();
      if (!b) break;
      // Atomic claim: only the runner that flips queued → running processes it.
      const { data: claimed } = await db
        .from("batches")
        .update({ status: "running" })
        .eq("id", b.id)
        .eq("status", "queued")
        .select("id");
      if (!claimed || claimed.length === 0) {
        results.push({ batch_id: b.id, status: "skipped" });
        continue;
      }
      try {
        const c = await runBatch(b.id);
        results.push({ batch_id: b.id, status: "done", scraped: c.scraped, rejected: c.rejected });
      } catch (err) {
        results.push({ batch_id: b.id, status: "failed", error: String(err).slice(0, 300) });
      }
    }
  });
  await Promise.all(workers);

  log.info(
    {
      ran: results.length,
      done: results.filter((r) => r.status === "done").length,
      failed: results.filter((r) => r.status === "failed").length,
    },
    "runQueuedBatches.done",
  );
  return { ran: results.length, results };
}
