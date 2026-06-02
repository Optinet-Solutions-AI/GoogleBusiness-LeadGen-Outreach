/**
 * app/api/voice/call/[id]/route.ts — Fetch one finished Vapi call (recording + summary).
 *
 * Inputs:  GET (call id in path)
 * Outputs: GET → CallInfo { recordingUrl, status, endedReason, durationSeconds, summary }
 * Used by: components/VapiTestCall.tsx (polls after a test call ends to show the replay)
 *
 * READ-ONLY: only reads a call; never mutates an assistant or call. The recording URL appears a
 * few seconds after hangup, so the client polls — a null recordingUrl means "not ready yet".
 */

import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isVapiConfigured, getCall } from "@/lib/services/voice/vapi-admin";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, ctx) => {
  if (!isVapiConfigured()) {
    return fail("Vapi not configured", 503);
  }
  const id = ctx?.params?.id;
  if (!id) {
    return fail("Missing call id", 400);
  }
  const call = await getCall(id);
  return ok(call);
});
