/**
 * stage-4-deploy.ts — Push a built site to Cloudflare Pages.
 *
 * Inputs:  lead row at stage='generated' (expects dist/ at .tmp/generated-sites/<slug>/dist)
 * Outputs: lead.demo_url set, lead.stage='deployed'
 * Used by: lib/pipeline/orchestrator.ts
 */

import path from "node:path";
import { getDb } from "../db";
import { getLogger } from "../logger";
import * as cloudflare from "../services/cloudflare-pages";
import { slugify } from "../slugify";

const log = getLogger("stage-4");

const REPO_ROOT = path.resolve(process.cwd(), "..");
const OUTPUT_ROOT = path.join(REPO_ROOT, ".tmp", "generated-sites");

export interface Lead {
  id: string;
  business_name: string;
}

export async function run(lead: Lead): Promise<string> {
  const slug = slugify(lead.business_name);
  const distDir = path.join(OUTPUT_ROOT, slug, "dist");

  log.info({ lead_id: lead.id, slug }, "stage_4.start");
  const liveUrl = await cloudflare.deploy(slug, distDir);

  const { error } = await getDb()
    .from("leads")
    .update({ demo_url: liveUrl, stage: "deployed" })
    .eq("id", lead.id);
  if (error) throw new Error(`stage_4.persist.error: ${error.message}`);

  log.info({ lead_id: lead.id, url: liveUrl }, "stage_4.done");
  return liveUrl;
}
