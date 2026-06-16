/**
 * api/leads/[id]/sequence/route.ts — Operator controls for the email sequence.
 *
 * POST /api/leads/:id/sequence  body { action: 'enroll' | 'stop' | 'recapture' }
 *   enroll    → start the 4-step progressive-trust sequence (next tick sends step 1)
 *   stop      → halt the sequence (operator takes over)
 *   recapture → re-shoot the demo screenshot (Cloud Run MODE=screenshot; needs Chromium)
 *
 * enroll/stop are pure DB updates and run here. recapture triggers the Cloud Run
 * job because screenshot capture needs Chromium (not available on Vercel).
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { enrollLeadInSequence, stopSequence } from "@/lib/pipeline/sequence-scheduler";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";
import * as stage4b from "@/lib/pipeline/stage-4b-screenshot";

const log = getLogger("api.leads.sequence");

const Body = z.object({ action: z.enum(["enroll", "stop", "recapture"]) });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const id = params.id;
  if (!id) return fail("Missing lead id", 400);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid body: action must be enroll|stop|recapture", 400);
  const { action } = parsed.data;

  if (action === "enroll") {
    const result = await enrollLeadInSequence(id);
    return result.enrolled ? ok(result) : fail(`Cannot enroll: ${result.reason}`, 409);
  }

  if (action === "stop") {
    await stopSequence(id, "operator");
    return ok({ stopped: true });
  }

  // recapture — Chromium-bound, so hand off to Cloud Run (mirrors the Build button).
  if (isCloudRunConfigured()) {
    const oidcToken =
      req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
    try {
      const op = await triggerJob({ MODE: "screenshot", LEAD_ID: id, FORCE: "1" }, { oidcToken });
      return ok({ id, status: "capturing", runner: "cloud-run", operation: op.operationName }, { status: 202 });
    } catch (err) {
      log.error({ lead_id: id, err: String(err) }, "cloud-run.trigger_failed");
      return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
    }
  }

  // Local-dev fallback: in-process (only works where Chromium is installed).
  const { data: lead } = await getDb()
    .from("leads")
    .select("id,business_name,demo_url,screenshot_url")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return fail("Lead not found", 404);
  const result = await stage4b.run(lead, { force: true });
  return ok({ ...result, runner: "local" });
});
