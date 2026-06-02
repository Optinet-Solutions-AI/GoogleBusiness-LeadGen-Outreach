/**
 * app/api/voice/agent/route.ts — Read and update the single managed Vapi assistant.
 *
 * Inputs:  GET (none); PATCH body { systemPrompt?, voice?: { voiceId?, model?, stability?, similarityBoost?, speed? } }
 * Outputs: GET → AgentInfo; PATCH → { saved: true }
 * Used by: components/AgentEditor.tsx
 *
 * SAFETY: PATCH never accepts an assistant id — updateAgent always uses env.VAPI_AGENT_ID.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isVapiConfigured, getAgent, updateAgent } from "@/lib/services/voice/vapi-admin";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  if (!isVapiConfigured()) {
    return fail("Vapi not configured", 503);
  }
  const agent = await getAgent();
  return ok(agent);
});

const PatchSchema = z.object({
  systemPrompt: z.string().optional(),
  voice: z
    .object({
      voiceId: z.string().optional(),
      model: z.string().optional(),
      stability: z.number().min(0).max(1).optional(),
      similarityBoost: z.number().min(0).max(1).optional(),
      speed: z.number().min(0.25).max(2).optional(),
    })
    .optional(),
});

export const PATCH = withApi(async (req) => {
  if (!isVapiConfigured()) {
    return fail("Vapi not configured", 503);
  }
  const raw = await req.json();
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join(", "), 400);
  }
  const { systemPrompt, voice } = parsed.data;
  await updateAgent({ systemPrompt, voice });
  return ok({ saved: true });
});
