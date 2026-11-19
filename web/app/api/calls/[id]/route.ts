/**
 * api/calls/[id]/route.ts — one AI call for the call viewer: labels, recording message and the transcript.
 *
 * Inputs:  GET, :id = call_attempts id
 * Outputs: { success, data: CallLogRow & { transcript } } · 404 when there's no such AI call
 * Used by: components/calls/CallViewer.tsx
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getCallLog } from "@/lib/calls/call-logs";
import { fail, ok } from "@/lib/response";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!z.string().uuid().safeParse(params.id).success) return fail("Not a call id", 422);
  try {
    const call = await getCallLog(params.id);
    return call ? ok(call) : fail("No such AI call.", 404);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 503);
  }
});
