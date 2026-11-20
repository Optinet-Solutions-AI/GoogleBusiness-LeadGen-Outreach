/**
 * api/leads/[id]/voice-test/route.ts — "Test voice agent" on a lead (browser call, nothing is dialled).
 *
 * Inputs:  GET = what the agent will be told (free) · POST { greeting_name?, offer? } = a new single-use Voizo test session
 * Outputs: { success, data: VoiceTestPreview } · { success, data: { publicKey, assistantId, assistantOverrides, sessionId } }
 *          · 409 + plain reason when Voizo refuses
 * Used by: components/outreach/VoiceTestModal.tsx
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { previewVoiceTest, startVoiceTest } from "@/lib/calls/voice-test-start";
import { fail, ok } from "@/lib/response";

export const dynamic = "force-dynamic";

const Body = z.object({ greeting_name: z.string().trim().max(40).nullish(), offer: z.string().trim().max(40).nullish() });

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!z.string().uuid().safeParse(params.id).success) return fail("Not a lead id", 422);
  return ok(await previewVoiceTest(params.id));
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!z.string().uuid().safeParse(params.id).success) return fail("Not a lead id", 422);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.message, 422);
  const r = await startVoiceTest(params.id, parsed.data.greeting_name ?? null, parsed.data.offer ?? null);
  return r.ok ? ok(r.session) : fail(r.message, 409);
});
