/**
 * api/voice/test-calls/route.ts — Persist + list in-browser test-call conversations.
 *
 * POST: save one finished test call { vapiCallId?, agentId?, transcript[], recordingUrl?, summary?, durationSeconds? }
 * GET:  list recent saved test calls (newest first) for the in-app history.
 * Used by: components/VapiTestCall.tsx (save on call end), components/SavedTestCalls.tsx (list).
 *
 * Stores conversations server-side so the whole team sees them in the app — not a local .txt.
 * Requires the test_calls table (migration 020); GET fails soft if it's missing.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export const dynamic = "force-dynamic";

const LineSchema = z.object({ role: z.string(), text: z.string() });
const Body = z.object({
  vapiCallId: z.string().optional(),
  agentId: z.string().optional(),
  transcript: z.array(LineSchema).default([]),
  recordingUrl: z.string().optional(),
  summary: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  const b = parsed.data;

  // Don't persist empty conversations.
  if (b.transcript.length === 0) return ok({ skipped: true });

  const { data, error } = await getDb()
    .from("test_calls")
    .insert({
      vapi_call_id: b.vapiCallId ?? null,
      agent_id: b.agentId ?? null,
      transcript: b.transcript,
      recording_url: b.recordingUrl ?? null,
      summary: b.summary ?? null,
      duration_seconds: b.durationSeconds ?? null,
    })
    .select("id")
    .single();
  if (error) return fail(error.message, 502);
  return ok({ id: (data as { id: string }).id });
});

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const { data, error } = await getDb()
    .from("test_calls")
    .select("id,vapi_call_id,agent_id,transcript,recording_url,summary,duration_seconds,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return fail(error.message, 502);
  return ok({ calls: data ?? [] });
});
