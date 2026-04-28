/**
 * orchestrator.ts — Drives the full 5-stage pipeline for one batch.
 *
 * Inputs:  batchId
 * Outputs: batch.status moves through queued → running → done; lead rows
 *          progress through stage values
 * Used by: scripts/run-batch.ts (CLI), app/api/batches/[id]/run/route.ts
 *
 * Failure policy:
 *   - one failed stage on one lead = log + lead.last_error + skip; rest of batch continues
 *   - whole batch only fails if scrape (stage 1) fails
 */

import crypto from "node:crypto";
import { getDb } from "../db";
import { getLogger } from "../logger";
import { estimate, type Scraper } from "../pricing";
import * as stage1 from "./stage-1-scrape";
import * as stage2 from "./stage-2-enrich";
import * as stage3 from "./stage-3-generate";
import * as stage4 from "./stage-4-deploy";
import * as stage5 from "./stage-5-outreach";

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

export async function runBatch(batchId: string): Promise<{
  enriched: number;
  generated: number;
  deployed: number;
  outreached: number;
  errors: number;
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

  try {
    await stage1.run(batch as stage1.Batch);
  } catch (err) {
    await db.from("batches").update({ status: "failed" }).eq("id", batchId);
    log.error({ batch_id: batchId, err: String(err) }, "orchestrator.scrape_failed");
    throw err;
  }

  const { data: leads } = await db
    .from("leads")
    .select("*")
    .eq("batch_id", batchId)
    .in("stage", ["scraped", "enriched", "generated", "deployed"]);

  const counters = { enriched: 0, generated: 0, deployed: 0, outreached: 0, errors: 0 };
  for (const lead of leads ?? []) {
    try {
      if (lead.stage === "scraped") {
        await stage2.run(lead as stage2.Lead);
        lead.stage = "enriched";
        counters.enriched += 1;
      }
      if (lead.stage === "enriched") {
        await stage3.run(lead as stage3.Lead, batch.template_slug);
        lead.stage = "generated";
        counters.generated += 1;
      }
      if (lead.stage === "generated") {
        lead.demo_url = await stage4.run(lead as stage4.Lead);
        lead.stage = "deployed";
        counters.deployed += 1;
      }
      if (lead.stage === "deployed") {
        await stage5.run(lead as stage5.Lead);
        counters.outreached += 1;
      }
    } catch (err) {
      counters.errors += 1;
      await db
        .from("leads")
        .update({ last_error: String(err).slice(0, 500) })
        .eq("id", lead.id);
      log.error({ lead_id: lead.id, err: String(err) }, "orchestrator.lead_failed");
    }
  }

  await db.from("batches").update({ status: "done" }).eq("id", batchId);
  log.info({ batch_id: batchId, ...counters }, "orchestrator.done");
  return counters;
}
