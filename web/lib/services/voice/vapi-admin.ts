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
import { AGENT_VOICE, AGENT_DELIVERY } from "@/lib/voice/agent-prompt";
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
  firstMessage?: string | null;
  voice?: VapiVoice | null;
  model?: {
    messages?: VapiMessage[];
  } | null;
}

export interface AgentInfo {
  id: string;
  name: string | null;
  firstMessage: string;
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
        cache: "no-store",
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
    firstMessage: raw.firstMessage ?? "",
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
    style?: number;
    useSpeakerBoost?: boolean;
    optimizeStreamingLatency?: number;
  };
}): Promise<void> {
  // SAFETY: agent id comes exclusively from server env, never from any request param.
  const agentId = env.VAPI_AGENT_ID;

  // Read the current assistant ONCE — needed to preserve model.provider on a prompt patch and to
  // keep the current voice id when only tuning the voice.
  const cur = await retry(
    () => fetch(`${BASE_URL}/assistant/${agentId}`, { method: "GET", headers: headers(), cache: "no-store" }),
    { maxAttempts: 3 },
  );
  if (!cur.ok) {
    throw new Error(`vapi.updateAgent.read.error ${cur.status}: ${await cur.text()}`);
  }
  const curRaw = (await cur.json()) as VapiAssistantRaw & { model?: Record<string, unknown> | null };

  const body: Record<string, unknown> = {};

  if (typeof input.systemPrompt === "string") {
    // Vapi requires model.provider + model name on a model patch. Preserve the assistant's CURRENT
    // model config and only swap the system message — never blow away provider/model/tools/temp.
    const curModel: Record<string, unknown> = { ...((curRaw.model as Record<string, unknown>) ?? {}) };
    const prev = Array.isArray(curModel.messages) ? [...(curModel.messages as VapiMessage[])] : [];
    const sysIdx = prev.findIndex((m) => m?.role === "system");
    if (sysIdx >= 0) {
      prev[sysIdx] = { ...prev[sysIdx], role: "system", content: input.systemPrompt };
    } else {
      prev.unshift({ role: "system", content: input.systemPrompt });
    }
    curModel.messages = prev;
    curModel.temperature = AGENT_DELIVERY.temperature; // warm, varied wording (less canned)
    curModel.maxTokens = AGENT_DELIVERY.maxTokens; // short human turns, no monologues
    if (curModel.provider === "openai") curModel.model = AGENT_DELIVERY.llmModel; // fastest capable → low latency
    body.model = curModel;
  }

  if (typeof input.firstMessage === "string") {
    body.firstMessage = input.firstMessage;
  }

  // Voice. The editor's Save passes an explicit (ElevenLabs) voiceId; the "Reset to recommended" apply path
  // passes none → we use AGENT_VOICE, which may be a Vapi-native voice (A/B) or the ElevenLabs clone.
  const explicitVoiceId = input.voice?.voiceId?.trim();
  const voiceProvider: string = AGENT_VOICE.provider; // widened to string so a revert to "11labs" still typechecks
  if (!explicitVoiceId && voiceProvider === "vapi") {
    // Vapi-native voice: minimal config — the ElevenLabs knobs (stability/style/filler/etc.) don't apply here.
    body.voice = { provider: "vapi", voiceId: AGENT_VOICE.voiceId, version: AGENT_VOICE.vapiVersion };
  } else {
    // ElevenLabs: use the chosen voiceId, else keep the current one; ALWAYS (re)apply the recommended tuning.
    const voiceId = explicitVoiceId || AGENT_VOICE.voiceId || curRaw.voice?.voiceId || "";
    if (voiceId) {
      body.voice = {
        provider: "11labs",
        voiceId,
        model: input.voice?.model ?? AGENT_VOICE.model,
        speed: input.voice?.speed ?? AGENT_VOICE.speed,
        stability: input.voice?.stability ?? AGENT_VOICE.stability,
        similarityBoost: input.voice?.similarityBoost ?? AGENT_VOICE.similarityBoost,
        style: input.voice?.style ?? AGENT_VOICE.style,
        useSpeakerBoost: input.voice?.useSpeakerBoost ?? AGENT_VOICE.useSpeakerBoost,
        fillerInjectionEnabled: AGENT_VOICE.fillerInjectionEnabled,
        optimizeStreamingLatency: input.voice?.optimizeStreamingLatency ?? AGENT_VOICE.optimizeStreamingLatency,
      };
    }
  }

  // Turn-taking + backchanneling (skill: the #1 humanness lever) — applied as the recommended baseline.
  body.startSpeakingPlan = AGENT_DELIVERY.startSpeakingPlan;
  body.stopSpeakingPlan = AGENT_DELIVERY.stopSpeakingPlan;
  body.backchannelingEnabled = AGENT_DELIVERY.backchannelingEnabled;

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
        cache: "no-store",
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

export interface CallInfo {
  id: string;
  status: string | null;
  endedReason: string | null;
  recordingUrl: string | null;
  durationSeconds: number | null;
  summary: string | null;
}

interface VapiCallRaw {
  id?: string;
  status?: string | null;
  endedReason?: string | null;
  recordingUrl?: string | null;
  stereoRecordingUrl?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  summary?: string | null;
  artifact?: {
    recordingUrl?: string | null;
    recording?: {
      mono?: { combinedUrl?: string | null } | null;
      stereoUrl?: string | null;
    } | null;
  } | null;
  analysis?: { summary?: string | null } | null;
}

/**
 * Fetch a finished call by id — READ-ONLY (used to replay the recording after a test call).
 * The recording URL only appears once Vapi finishes post-processing (a few seconds after hangup),
 * so callers poll a couple times; null recordingUrl means "not ready yet" (or recording disabled).
 */
export async function getCall(callId: string): Promise<CallInfo> {
  log.info({ callId }, "vapi-admin.getCall");

  const resp = await retry(
    () =>
      fetch(`${BASE_URL}/call/${callId}`, {
        method: "GET",
        headers: headers(),
        cache: "no-store", // Next caches fetch() indefinitely → would replay a stale "in-progress" (no recording yet)
      }),
    { maxAttempts: 3 },
  );

  if (!resp.ok) {
    throw new Error(`vapi.getCall.error ${resp.status}: ${await resp.text()}`);
  }

  const raw = (await resp.json()) as VapiCallRaw;

  const recordingUrl =
    raw.artifact?.recordingUrl ??
    raw.recordingUrl ??
    raw.artifact?.recording?.mono?.combinedUrl ??
    raw.artifact?.recording?.stereoUrl ??
    raw.stereoRecordingUrl ??
    null;

  let durationSeconds: number | null = null;
  if (raw.startedAt && raw.endedAt) {
    const ms = Date.parse(raw.endedAt) - Date.parse(raw.startedAt);
    if (Number.isFinite(ms) && ms > 0) durationSeconds = Math.round(ms / 1000);
  }

  log.info({ callId, status: raw.status ?? null, hasRecording: Boolean(recordingUrl) }, "vapi-admin.getCall.ok");

  return {
    id: raw.id ?? callId,
    status: raw.status ?? null,
    endedReason: raw.endedReason ?? null,
    recordingUrl,
    durationSeconds,
    summary: raw.summary ?? raw.analysis?.summary ?? null,
  };
}
