/**
 * api/batches/[id]/control/route.ts — Pause / resume / cancel a scraping batch.
 *
 * Inputs:  POST { action: "pause" | "resume" | "cancel" }
 * Outputs: ok({ status, stop_requested, run }) — run=true means the caller should POST /api/batches/:id/run next;
 *          fail(409) when the action doesn't apply to the batch's status
 * Used by: components/BatchControls.tsx
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { BatchControlError, controlBatch } from "@/lib/pipeline/batch-control";

const Body = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

export const dynamic = "force-dynamic";

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("action must be pause, resume or cancel", 400);
  try {
    return ok(await controlBatch(params.id, parsed.data.action));
  } catch (err) {
    if (err instanceof BatchControlError) return fail(err.message, err.message === "batch not found" ? 404 : 409);
    throw err;
  }
});
