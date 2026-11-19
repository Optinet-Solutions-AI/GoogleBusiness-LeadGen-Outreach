/**
 * calls/voice-agents.ts — the Voizo scripts the operator can pick per AI call (19 Nov 2026, migration 064).
 *
 * Inputs:  agents typed in on the Voice agents page (name, Voizo script id from Script Builder, optional link, default)
 * Outputs: voice_agents rows (one default; archive, never delete); the Voizo script id for a chosen agent. Voizo has no
 *          "list scripts" API, so the list lives here; the scripts themselves are built and tested in Script Builder.
 *          Before migration 064 reads return [] with `missing: true`.
 * Used by: app/api/voice-agents/**, lib/calls/load-call-preview.ts, lib/calls/quick-call.ts
 */
import "@/lib/server-guard";
import { z } from "zod";
import { getDb } from "@/lib/db";

export const AgentInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  voizo_campaign_id: z.string().trim().min(1).max(100),
  // http(s) only: the link is rendered as a clickable <a>, and a javascript: link would run code when clicked.
  script_builder_url: z.string().trim().url().regex(/^https?:\/\//i, "Use an http(s) link").nullable().default(null),
  notes: z.string().trim().max(500).nullable().default(null),
  is_default: z.boolean().default(false),
});
export type AgentInput = z.infer<typeof AgentInputSchema>;

export interface VoiceAgent {
  id: string;
  name: string;
  voizo_campaign_id: string;
  script_builder_url: string | null;
  notes?: string | null;
  is_default: boolean;
  archived: boolean;
}

export const MISSING_064_AGENTS = "Voice agents need database update 064 (run db/migrations/064_templates_agents.sql in Supabase).";

/** The active agent marked default; none marked = null (Voizo's default script is used). Pure. */
export function defaultAgent<T extends Pick<VoiceAgent, "is_default" | "archived">>(agents: T[]): T | null {
  return agents.find((a) => !a.archived && a.is_default) ?? null;
}

/** Ids that must lose "default" when `savedId` becomes the default (only one default). Pure. */
export function defaultsToClear(agents: Pick<VoiceAgent, "id" | "is_default">[], savedId: string): string[] {
  return agents.filter((a) => a.is_default && a.id !== savedId).map((a) => a.id);
}

/** The Voizo script id for the chosen agent; none chosen, unknown or archived = null (Voizo's default script). Pure. */
export function resolveAgentCampaign(agents: Pick<VoiceAgent, "id" | "voizo_campaign_id" | "archived">[], agentId: string | null | undefined): string | null {
  if (!agentId) return null;
  const a = agents.find((x) => x.id === agentId && !x.archived);
  return a?.voizo_campaign_id ?? null;
}

function isMissingTable(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("voice_agents") && (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"));
}

const COLS = "id,name,voizo_campaign_id,script_builder_url,notes,is_default,archived";

export async function listAgents(opts: { includeArchived?: boolean } = {}): Promise<{ agents: VoiceAgent[]; missing: boolean }> {
  let q = getDb().from("voice_agents").select(COLS).order("created_at", { ascending: true });
  if (!opts.includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error.message)) return { agents: [], missing: true };
    throw new Error(error.message);
  }
  return { agents: (data ?? []) as VoiceAgent[], missing: false };
}

async function keepOneDefault(savedId: string): Promise<void> {
  const { agents } = await listAgents({ includeArchived: true });
  const clear = defaultsToClear(agents, savedId);
  if (clear.length) await getDb().from("voice_agents").update({ is_default: false }).in("id", clear);
}

export async function createAgent(input: AgentInput): Promise<VoiceAgent> {
  const { data, error } = await getDb().from("voice_agents").insert(input).select(COLS).single();
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064_AGENTS : error.message);
  const agent = data as VoiceAgent;
  if (agent.is_default) await keepOneDefault(agent.id);
  return agent;
}

export async function updateAgent(id: string, patch: Partial<AgentInput> & { archived?: boolean }): Promise<VoiceAgent> {
  const { data, error } = await getDb()
    .from("voice_agents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064_AGENTS : error.message);
  const agent = data as VoiceAgent;
  if (agent.is_default) await keepOneDefault(agent.id);
  return agent;
}
