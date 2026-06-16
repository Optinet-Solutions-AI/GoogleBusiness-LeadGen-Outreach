/**
 * stage-4b-screenshot.ts — Capture + host a screenshot of the deployed demo site.
 *
 * Inputs:  a lead at stage='deployed' ({ id, business_name, demo_url, screenshot_url? })
 * Outputs: leads.screenshot_url + screenshot_captured_at; PNG hosted in Supabase Storage
 * Used by: lib/pipeline/build-lead.ts (right after stage 4), cloud-run-job MODE=screenshot
 *
 * The screenshot is embedded inline (CID) in outreach emails 2-4 — see
 * lib/pipeline/sequence-scheduler.ts. We host on Supabase Storage (public
 * bucket) rather than the Pages site so it has a stable https URL the SMTP
 * sender can fetch, with no re-deploy and no dependency on dist/ still existing
 * (Cloud Run gives each execution a fresh filesystem). Idempotent: a lead that
 * already has a screenshot_url is skipped. Never throws — a missing screenshot
 * just means email 2 sends without an image.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import { slugify } from "../slugify";
import { captureDemoScreenshot } from "../services/screenshot";

const log = getLogger("stage-4b");

const BUCKET = "lead-screenshots";

export interface Lead {
  id: string;
  business_name: string;
  demo_url?: string | null;
  screenshot_url?: string | null;
}

export async function run(
  lead: Lead,
  opts?: { force?: boolean },
): Promise<{ captured: boolean; url?: string }> {
  // Skip if already captured (backfill-friendly). `force` re-captures after a
  // rebuild/improve or an operator "re-capture" action; the Storage upload
  // upserts so the URL stays stable.
  if (!opts?.force && lead.screenshot_url) {
    log.info({ lead_id: lead.id }, "stage_4b.skip_already_captured");
    return { captured: false, url: lead.screenshot_url };
  }

  const captureUrl = lead.demo_url || `https://${slugify(lead.business_name)}.pages.dev`;
  log.info({ lead_id: lead.id, captureUrl }, "stage_4b.start");

  const png = await captureDemoScreenshot(captureUrl);
  if (!png) {
    log.warn({ lead_id: lead.id }, "stage_4b.no_screenshot");
    return { captured: false };
  }

  const db = getDb();
  // Ensure the public bucket exists (idempotent — ignores "already exists").
  await db.storage.createBucket(BUCKET, { public: true }).catch(() => undefined);

  const objectPath = `${lead.id}.png`;
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(objectPath, png, { contentType: "image/png", upsert: true });
  if (upErr) {
    log.warn({ lead_id: lead.id, err: upErr.message }, "stage_4b.upload_failed");
    return { captured: false };
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(objectPath);
  const url = pub.publicUrl;

  await db
    .from("leads")
    .update({ screenshot_url: url, screenshot_captured_at: new Date().toISOString() })
    .eq("id", lead.id);

  log.info({ lead_id: lead.id, url }, "stage_4b.done");
  return { captured: true, url };
}
