/**
 * api/voice-agents/[id]/route.ts — edit one voice agent, make it the default, or archive / unarchive it.
 *
 * Inputs:  PATCH partial AgentInput and/or { archived: boolean }
 * Outputs: { success, data: agent }
 * Used by: the Voice agents page
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { AgentInputSchema, updateAgent } from "@/lib/calls/voice-agents";
import { fail, ok } from "@/lib/response";
import { z } from "zod";

const Patch = AgentInputSchema.partial().extend({ archived: z.boolean().optional() });

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  try {
    return ok(await updateAgent(params.id, parsed.data));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 503);
  }
});
