/**
 * vapi-admin.ts — Vapi assistant admin client (server-only).
 *
 * Inputs:  env.VAPI_API_KEY, env.VAPI_AGENT_ID (server env — never from client)
 * Outputs: assistant data (getAgent), mutation result (updateAgent), voice list (listVoices)
 * Used by: app/api/voice/agent/route.ts, app/api/voice/voices/route.ts
 *
 * SAFETY: updateAgent targets ONLY env.VAPI_AGENT_ID — never an id from the request.
 * All other assistants in the account are untouched.
 */

import "server-only";

import { env } from "@/lib/config";
import { retry } from "@/lib/retry";
import { getLogger } from "@/lib/logger";
import { listElevenLabsVoices } from "./elevenlabs";

const log = getLogger("vapi-admin");
const BASE_URL = "https://api.vapi.ai";

function headers(): Record<string, string> {
  if (!env.VAPI_API_KEY) throw new Error("VAPI_API_KEY missing");
  return {
    Authorization: env.VAPI_API_KEY,
    "Content-Type": "application/json",
  };
}

export function isVapiConfigured(): boolean {
  return Boolean(env.VAPI_API_KEY && env.VAPI_AGENT_ID);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface VapiMessage {
  role: string;
  content: string;
}

interface VapiVoice {
  provider?: string | null;
  voiceId?: string | null;
  name?: string | null;
  model?: string | null;
  stability?: number | null;
  similarityBoost?: number | null;
  speed?: number | null;
}

interface VapiAssistantRaw {
  id?: string;
  name?: string | null;
  voice?: VapiVoice | null;
  model?: {
    messages?: VapiMessage[];
  } | null;
}

export interface AgentInfo {
  id: string;
  name: string | null;
  systemPrompt: string;
  voice: {
    provider: string | null;
    voiceId: string | null;
    model: string | null;
    stability: number | null;
    similarityBoost: number | null;
    speed: number | null;
  };
}

export interface VoiceOption {
  provider: string;
  voiceId: string;
  label: string;
}

// ── Exported functions ─────────────────────────────────────────────────────────

/**
 * Fetch the single agent this app manages.
 * Reads env.VAPI_AGENT_ID — the id is never taken from the caller.
 */
export async function getAgent(): Promise<AgentInfo> {
  const agentId = env.VAPI_AGENT_ID;
  log.info({ agentId }, "vapi-admin.getAgent");

  const resp = await retry(
    () =>
      fetch(`${BASE_URL}/assistant/${agentId}`, {
        method: "GET",
        headers: headers(),
      }),
    { maxAttempts: 3 },
  );

  if (!resp.ok) {
    throw new Error(`vapi.getAgent.error ${resp.status}: ${await resp.text()}`);
  }

  const raw = (await resp.json()) as VapiAssistantRaw;

  const systemMessage = (raw.model?.messages ?? []).find((m) => m.role === "system");
  const systemPrompt = systemMessage?.content ?? "";

  log.info({ agentId, name: raw.name ?? null }, "vapi-admin.getAgent.ok");

  return {
    id: raw.id ?? agentId,
    name: raw.name ?? null,
    systemPrompt,
    voice: {
      provider: raw.voice?.provider ?? null,
      voiceId: raw.voice?.voiceId ?? null,
      model: raw.voice?.model ?? null,
      stability: raw.voice?.stability ?? null,
      similarityBoost: raw.voice?.similarityBoost ?? null,
      speed: raw.voice?.speed ?? null,
    },
  };
}

/**
 * Patch the single agent this app manages.
 * ALWAYS targets env.VAPI_AGENT_ID — the id is NEVER taken from the caller.
 */
export async function updateAgent(input: {
  systemPrompt?: string;
  firstMessage?: string;
  voice?: {
    voiceId?: string;
    model?: string;
    stability?: number;
    similarityBoost?: number;
    speed?: number;
  };
}): Promise<void> {
  // SAFETY: agent id comes exclusively from server env, never from any request param.
  const agentId = env.VAPI_AGENT_ID;

  const body: Record<string, unknown> = {};

  if (typeof input.systemPrompt === "string") {
    body.model = {
      messages: [{ role: "system", content: input.systemPrompt }],
    };
  }

  if (typeof input.firstMessage === "string") {
    body.firstMessage = input.firstMessage;
  }

  if (input.voice?.voiceId) {
    const voiceBody: Record<string, unknown> = {
      provider: "11labs",
      voiceId: input.voice.voiceId,
    };
    if (input.voice.model !== undefined) voiceBody.model = input.voice.model;
    if (input.voice.stability !== undefined) voiceBody.stability = input.voice.stability;
    if (input.voice.similarityBoost !== undefined) voiceBody.similarityBoost = input.voice.similarityBoost;
    if (input.voice.speed !== undefined) voiceBody.speed = input.voice.speed;
    body.voice = voiceBody;
  }

  log.info({ agentId, fields: Object.keys(body) }, "vapi-admin.updateAgent");

  const resp = await retry(
    () =>
      fetch(`${BASE_URL}/assistant/${agentId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(body),
      }),
    { maxAttempts: 3 },
  );

  if (!resp.ok) {
    throw new Error(`vapi.updateAgent.error ${resp.status}: ${await resp.text()}`);
  }

  log.info({ agentId }, "vapi-admin.updateAgent.ok");
}

/**
 * List voices for the voice picker.
 *
 * Preference order:
 *   1. Full ElevenLabs library (requires ELEVENLABS_API_KEY) — most complete.
 *   2. Fallback: voices derived from Vapi assistants (sparse — one per assistant).
 *
 * READ-ONLY — does not write anything.
 */
export async function listVoices(): Promise<VoiceOption[]> {
  log.info({}, "vapi-admin.listVoices");

  // 1. Try ElevenLabs first — returns [] when key is missing or on error.
  const elevenLabsVoices = await listElevenLabsVoices();
  if (elevenLabsVoices.length > 0) {
    log.info({ count: elevenLabsVoices.length, source: "elevenlabs" }, "vapi-admin.listVoices.ok");
    return elevenLabsVoices;
  }

  // 2. Fallback: derive from Vapi assistants.
  log.info({}, "vapi-admin.listVoices.fallback (elevenlabs empty — reading vapi assistants)");

  const resp = await retry(
    () =>
      fetch(`${BASE_URL}/assistant?limit=100`, {
        method: "GET",
        headers: headers(),
      }),
    { maxAttempts: 3 },
  );

  if (!resp.ok) {
    throw new Error(`vapi.listVoices.error ${resp.status}: ${await resp.text()}`);
  }

  const assistants = (await resp.json()) as VapiAssistantRaw[];

  const seen = new Set<string>();
  const voices: VoiceOption[] = [];

  for (const assistant of assistants) {
    const v = assistant.voice;
    if (!v?.provider || !v?.voiceId) continue;

    const key = `${v.provider}:${v.voiceId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = v.name
      ? String(v.name)
      : `${v.provider} · ${String(v.voiceId).slice(0, 10)}…`;

    voices.push({ provider: v.provider, voiceId: v.voiceId, label });
  }

  voices.sort((a, b) => a.label.localeCompare(b.label));

  log.info({ count: voices.length, source: "vapi-assistants" }, "vapi-admin.listVoices.ok");
  return voices;
}
