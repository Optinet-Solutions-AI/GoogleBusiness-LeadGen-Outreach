/**
 * scripts/cloud-run-job.ts — Entrypoint for the Cloud Run Job container.
 *
 * Dispatches on MODE env var so the same image serves every long-running
 * workload that's too slow for Vercel's 60s function cap:
 *
 *   MODE=batch       BATCH_ID=<uuid>                     → orchestrator.runBatch (scrape)
 *   MODE=build       LEAD_ID=<uuid>                      → buildLead (stages 2→3→4)
 *   MODE=improve     LEAD_ID=<uuid> IMPROVE_PAYLOAD_BASE64=<b64-json> → improve.run
 *   MODE=regenerate  LEAD_ID=<uuid> FROM_STAGE=<step>    → re-run from a given step
 *
 * MODE defaults to "batch" for backward compatibility with the original
 * scrape-only entrypoint.
 *
 * Used by: the deployed Cloud Run Job `lead-batch-runner`.
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
// .env at repo root if it happens to be there (local docker run); in
// production Cloud Run injects env vars from Secret Manager directly.
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

import { runBatch } from "@/lib/pipeline/orchestrator";
import { buildLead } from "@/lib/pipeline/build-lead";
import { run as runImprove, type ImproveInput } from "@/lib/pipeline/improve";
import { getDb } from "@/lib/db";
import * as stage2 from "@/lib/pipeline/stage-2-enrich";
import * as stage3 from "@/lib/pipeline/stage-3-generate";
import * as stage4 from "@/lib/pipeline/stage-4-deploy";
import * as stage5 from "@/lib/pipeline/stage-5-outreach";
import { getLogger } from "@/lib/logger";

const log = getLogger("cloud-run-job");

type Mode = "batch" | "build" | "improve" | "regenerate";

function readMode(): Mode {
  const m = (process.env.MODE ?? "batch").toLowerCase();
  if (m === "batch" || m === "build" || m === "improve" || m === "regenerate") return m;
  throw new Error(`unknown MODE: ${m}`);
}

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    log.error({ var: name }, "missing required env var");
    process.exit(2);
  }
  return v;
}

function decodePayload<T>(envName: string): T {
  const raw = process.env[envName];
  if (!raw) {
    log.error({ var: envName }, "missing payload env var");
    process.exit(2);
  }
  const json = Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json) as T;
}

async function main() {
  const mode = readMode();

  if (mode === "batch") {
    const batchId = readEnv("BATCH_ID");
    log.info({ mode, batch_id: batchId }, "job.start");
    const counters = await runBatch(batchId);
    log.info({ mode, batch_id: batchId, ...counters }, "job.done");
    return;
  }

  if (mode === "build") {
    const leadId = readEnv("LEAD_ID");
    log.info({ mode, lead_id: leadId }, "job.start");
    const result = await buildLead(leadId);
    log.info({ mode, ...result }, "job.done");
    return;
  }

  if (mode === "improve") {
    const leadId = readEnv("LEAD_ID");
    const payload = decodePayload<ImproveInput>("IMPROVE_PAYLOAD_BASE64");
    log.info({ mode, lead_id: leadId }, "job.start");
    await runImprove(leadId, payload);
    log.info({ mode, lead_id: leadId }, "job.done");
    return;
  }

  if (mode === "regenerate") {
    const leadId = readEnv("LEAD_ID");
    const requestedFrom = readEnv("FROM_STAGE") as "enrich" | "generate" | "deploy" | "outreach";

    // Cloud Run gives every job a fresh empty filesystem, so stage 4's
    // dist/ never persists between invocations. A "deploy-only" regenerate
    // hits ENOENT on wrangler scandir. Bump the start back to 'generate'
    // so we always rebuild dist/ before deploying. (Pure 'outreach' is OK
    // because stage 5 doesn't read the filesystem.)
    const fromStage: typeof requestedFrom =
      requestedFrom === "deploy" ? "generate" : requestedFrom;
    if (fromStage !== requestedFrom) {
      log.info(
        { mode, lead_id: leadId, requested: requestedFrom, effective: fromStage },
        "job.regenerate.bumped",
      );
    }
    log.info({ mode, lead_id: leadId, from_stage: fromStage }, "job.start");

    const db = getDb();
    const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single();
    if (!lead) throw new Error(`lead not found: ${leadId}`);
    const { data: batch } = await db
      .from("batches")
      .select("template_slug")
      .eq("id", lead.batch_id)
      .single();
    const ORDER = ["enrich", "generate", "deploy", "outreach"] as const;
    const start = ORDER.indexOf(fromStage);
    if (start < 0) throw new Error(`invalid FROM_STAGE: ${fromStage}`);
    try {
      for (const step of ORDER.slice(start)) {
        if (step === "enrich") await stage2.run(lead);
        if (step === "generate") await stage3.run(lead, batch?.template_slug ?? "trades");
        if (step === "deploy") lead.demo_url = await stage4.run(lead);
        if (step === "outreach") await stage5.run(lead);
      }
      // Match build-lead.ts: clear any prior failure now that the regen
      // succeeded, so the dashboard doesn't keep showing a stale red box.
      await db.from("leads").update({ last_error: null }).eq("id", leadId);
    } catch (err) {
      await db
        .from("leads")
        .update({ last_error: String(err).slice(0, 500) })
        .eq("id", leadId);
      throw err;
    }
    log.info({ mode, lead_id: leadId }, "job.done");
    return;
  }
}

main().catch((err) => {
  log.error({ err: String(err), stack: err?.stack }, "job.failed");
  process.exit(1);
});
