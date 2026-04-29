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

  await db.from("batches").update({ status: "done" }).eq("id", batchId);
  log.info({ batch_id: batchId, ...result }, "orchestrator.done");
  return { scraped: result.accepted, rejected: result.rejected };
}
