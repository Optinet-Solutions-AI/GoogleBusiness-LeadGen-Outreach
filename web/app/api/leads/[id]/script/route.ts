/**
 * api/leads/[id]/script/route.ts — Fetch the generated call script for a lead.
 *
 * GET /api/leads/:id/script
 *   → { script_snapshot, offer_pitched, status, attempt_id } from the lead's
 *     most-recent call_attempt. 404 when no attempt exists yet (call first).
 *
 * Read-only. The script is the text a human (or future voice agent) reads on
 * the call; it's snapshotted on the attempt at enqueue time.
 */

import { getDb } from "@/lib/db";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  const { data, error } = await getDb()
    .from("call_attempts")
    .select("id, script_snapshot, offer_pitched, status, created_at")
    .eq("lead_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!data) return fail("no call script yet — start a call first", 404);

  return ok({
    attempt_id: data.id,
    script_snapshot: data.script_snapshot,
    offer_pitched: data.offer_pitched,
    status: data.status,
  });
});
