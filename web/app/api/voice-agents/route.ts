/**
 * api/voice-agents/route.ts — list / add the voice agents (Voizo scripts) the operator can pick per AI call (064).
 *
 * Inputs:  GET ?archived=1 · POST AgentInput { name, voizo_campaign_id, script_builder_url?, notes?, is_default? }
 * Outputs: { success, data: { agents, missing } } · { success, data: agent }
 * Used by: the Voice agents page
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { AgentInputSchema, createAgent, listAgents } from "@/lib/calls/voice-agents";
import { fail, ok } from "@/lib/response";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req: Request) => {
  if (!isDbConfigured()) return ok({ agents: [], missing: true });
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  return ok(await listAgents({ includeArchived }));
});

export const POST = withApi(async (req: Request) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = AgentInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  try {
    return ok(await createAgent(parsed.data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(/duplicate|unique/i.test(msg) ? "That Voizo script id is already in the list." : msg, /duplicate|unique/i.test(msg) ? 409 : 503);
  }
});
