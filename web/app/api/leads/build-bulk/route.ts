/**
 * api/leads/build-bulk/route.ts — build demo sites for many leads at once.
 *
 * POST { lead_ids: string[], concurrency? }
 *   - Cloud Run: one MODE=build-queue execution drains the list with a worker
 *     pool (non-buildable niches are skipped, failures isolated).
 *   - Local dev: runs runQueuedBuilds in-process (fire-and-forget).
 *
 * Marks each lead rebuild_started_at so the dashboard shows the building state.
 * Building is a paid-ish action (Gemini copy + Cloudflare deploy + screenshot),
 * so the caller (the dashboard) confirms the count first.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";
import { runQueuedBuilds } from "@/lib/pipeline/build-queue";
import { getLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("api.leads.build-bulk");

const Body = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(200),
  concurrency: z.number().int().min(1).max(4).optional(),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Provide lead_ids (1-200)", 400);
  const { lead_ids, concurrency } = parsed.data;

  const db = getDb();
  // Mark all as in-progress so the dashboard shows the building spinner.
  await db
    .from("leads")
    .update({ rebuild_started_at: new Date().toISOString(), last_error: null })
    .in("id", lead_ids);

  if (isCloudRunConfigured()) {
    const oidcToken = req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
    const payload = Buffer.from(JSON.stringify(lead_ids), "utf8").toString("base64");
    try {
      const opEnv: Record<string, string> = { MODE: "build-queue", LEAD_IDS_BASE64: payload };
      if (concurrency) opEnv.BUILD_CONCURRENCY = String(concurrency);
      const op = await triggerJob(opEnv, { oidcToken });
      return ok(
        { queued: lead_ids.length, runner: "cloud-run", operation: op.operationName },
        { status: 202 },
      );
    } catch (err) {
      await db.from("leads").update({ rebuild_started_at: null }).in("id", lead_ids);
      log.error({ count: lead_ids.length, err: String(err) }, "build-bulk.trigger_failed");
      return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
    }
  }

  // Local-dev path: in-process (fire-and-forget).
  runQueuedBuilds({ leadIds: lead_ids, concurrency }).catch((err) =>
    log.error({ err: String(err) }, "build-bulk.local_failed"),
  );
  return ok({ queued: lead_ids.length, runner: "local" }, { status: 202 });
});
