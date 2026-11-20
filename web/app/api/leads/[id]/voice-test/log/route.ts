/**
 * api/leads/[id]/voice-test/log/route.ts — save a finished browser test call into Call logs.
 *
 * Inputs:  POST TestCallLog { vapiCallId?, offerKey?, offerLabel?, greeting?, lines[], startedAt?, endedAt? }
 * Outputs: { success, data: { id } }
 * Used by: components/outreach/VoiceTestModal.tsx (when the test call ends)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { saveTestCall, TestCallLogSchema } from "@/lib/calls/voice-test-log";
import { fail, ok } from "@/lib/response";

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!z.string().uuid().safeParse(params.id).success) return fail("Not a lead id", 422);
  const parsed = TestCallLogSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  return ok(await saveTestCall(params.id, parsed.data));
});
