/**
 * calls/voice-test-log.ts — save a finished "Test voice agent" browser call into Call logs (20 Nov 2026).
 *
 * Inputs:  lead id + what the browser saw: Vapi call id, offer tried, greeting, the conversation, start/end times
 * Outputs: one call_attempts row (provider 'voizo', meta.call_type 'browser_test', done) — no campaign, no phone, no
 *          stage change. The call worker's recording sweep then copies its recording from Vapi like any call.
 * Used by: app/api/leads/[id]/voice-test/log/route.ts
 */
import "@/lib/server-guard";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { testCallTranscript } from "./voice-test";

const log = getLogger("voice-test.log");

export const TestCallLogSchema = z.object({
  vapiCallId: z.string().trim().max(100).nullish(),
  offerKey: z.string().trim().max(40).nullish(),
  offerLabel: z.string().trim().max(120).nullish(),
  greeting: z.string().trim().max(40).nullish(),
  lines: z.array(z.object({ role: z.string().max(20), text: z.string().max(4000) })).max(400).default([]),
  startedAt: z.string().datetime().nullish(),
  endedAt: z.string().datetime().nullish(),
});
export type TestCallLog = z.infer<typeof TestCallLogSchema>;

export async function saveTestCall(leadId: string, input: TestCallLog): Promise<{ id: string }> {
  const started = input.startedAt ?? null;
  const ended = input.endedAt ?? new Date().toISOString();
  const durationSec = started ? Math.max(0, Math.round((Date.parse(ended) - Date.parse(started)) / 1000)) : null;
  const { data, error } = await getDb()
    .from("call_attempts")
    .insert({
      lead_id: leadId,
      provider: "voizo",
      status: "completed",
      done: true,
      processed_at: new Date().toISOString(),
      started_at: started,
      ended_at: ended,
      duration_sec: durationSec,
      transcript: testCallTranscript(input.lines) || null,
      meta: {
        call_type: "browser_test",
        vapi_call_id: input.vapiCallId || null,
        agent_name: input.offerLabel || null,
        offer_key: input.offerKey || null,
        greeting: input.greeting || null,
      },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't save the test call");
  log.info({ lead_id: leadId, attempt_id: (data as { id: string }).id, has_vapi_id: Boolean(input.vapiCallId) }, "voice_test.logged");
  return data as { id: string };
}
