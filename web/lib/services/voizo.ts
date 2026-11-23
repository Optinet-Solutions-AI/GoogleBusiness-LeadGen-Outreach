/**
 * voizo.ts — Voizo Dial API client (one AI phone call per request).
 *
 * Inputs:  VOIZO_API_KEY / VOIZO_API_BASE; a phone (E.164) + optional first name + our lead id
 * Outputs: typed { ok, data } | { ok:false, status, code, error } results — never throws
 * Used by: lib/pipeline/call-scheduler.ts, scripts/voizo-check.ts, the campaign call panel
 *
 * Endpoints: GET /api/v1/status · POST /api/v1/calls · GET /api/v1/calls/:id[?include=transcript] ·
 * POST /api/v1/test-calls (a browser test session — nothing is dialled; 20 Nov 2026) · GET /api/v1/scripts (one
 * script per offer; offerKey null = not named to convention, don't show it) · training (23 Nov 2026, see
 * workflows/train_voice_agent.md): POST /api/v1/scripts/:id/train (propose wording changes from a plain instruction),
 * POST …/train/:proposalId/apply, POST …/changes/:changeId/undo, GET …/changes. Until Voizo ships these they answer
 * 404 → code "http_404".
 * Branch on `code`, never on the error text (Voizo rewords the sentences).
 *
 * The dial POST is NEVER retried: a lost 202 followed by a retry would either double-dial or
 * return 429 busy and lose the callId. A network failure there surfaces as code "network_error"
 * and the caller treats it as "may have been placed". The two GETs retry with backoff.
 */

import "@/lib/server-guard";
import { z } from "zod";
import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("voizo");

export type VoizoResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; error: string };

const StatusSchema = z.object({
  ready: z.boolean(),
  campaignId: z.string().nullish(),
  campaignName: z.string().nullish(),
  shadow: z.boolean(),
  timezone: z.string().nullish(),
  callWindowOpen: z.boolean().nullish(),
  callWindows: z.array(z.object({ day: z.string(), start: z.string(), end: z.string() })).nullish(),
  usedToday: z.number().nullish(),
  dailyCap: z.number().nullish(),
  remainingToday: z.number().nullish(),
  resetsAt: z.string().nullish(),
  inFlight: z.number().nullish(),
  maxConcurrent: z.number().nullish(),
  scriptId: z.string().nullish(),
  /** Every {{token}} the campaign's script uses; null = Voizo couldn't read the script (unknown, not "none"). */
  scriptVariables: z.array(z.string()).nullish(),
});
export type VoizoStatus = z.infer<typeof StatusSchema>;

const DialSchema = z.object({
  ok: z.boolean().optional(),
  callId: z.string(),
  status: z.string().nullish(),
  remainingToday: z.number().nullish(),
});
export type VoizoDial = z.infer<typeof DialSchema>;

const CallSchema = z.object({
  callId: z.string(),
  done: z.boolean(),
  status: z.string().nullish(),
  endedReason: z.string().nullish(),
  voicemail: z.boolean().nullish(),
  answeredAt: z.string().nullish(),
  endedAt: z.string().nullish(),
  durationSeconds: z.number().nullish(),
  goalReached: z.boolean().nullish(),
  outcome: z.string().nullish(),
  attemptCount: z.number().nullish(),
  vapiCallId: z.string().nullish(),
  recordingAvailable: z.boolean().nullish(),
  transcript: z.string().nullish(),
});
export type VoizoCall = z.infer<typeof CallSchema>;

export function isVoizoConfigured(): boolean {
  return Boolean(env.VOIZO_API_KEY);
}

function url(path: string): string {
  return `${env.VOIZO_API_BASE.replace(/\/$/, "")}${path}`;
}

/** Thrown inside retry() only for responses worth retrying (5xx on a GET). */
class RetryableStatus extends Error {}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  timeoutMs = 20_000,
): Promise<VoizoResult<T>> {
  if (!isVoizoConfigured()) {
    return { ok: false, status: 0, code: "not_configured", error: "VOIZO_API_KEY is not set" };
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${env.VOIZO_API_KEY}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  };

  let resp: Response;
  try {
    resp =
      method === "GET"
        ? await retry(
            async () => {
              const r = await fetch(url(path), init);
              if (r.status >= 500) throw new RetryableStatus(String(r.status));
              return r;
            },
            { maxAttempts: 3, initialMs: 1000 },
          ).catch(async (err) => {
            // Out of retries on a 5xx: make one last plain fetch so the caller gets the real code.
            if (err instanceof RetryableStatus) return fetch(url(path), init);
            throw err;
          })
        : await fetch(url(path), init);
  } catch (err) {
    log.warn({ method, path, err: String(err) }, "voizo.request.network_error");
    return { ok: false, status: 0, code: "network_error", error: String(err) };
  }

  const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  if (!resp.ok) {
    const code = typeof json?.code === "string" ? json.code : `http_${resp.status}`;
    const error = typeof json?.error === "string" ? json.error : resp.statusText;
    log.warn({ method, path, status: resp.status, code }, "voizo.request.refused");
    return { ok: false, status: resp.status, code, error };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    log.warn({ method, path, issues: parsed.error.issues.slice(0, 3) }, "voizo.request.bad_shape");
    return { ok: false, status: resp.status, code: "bad_response", error: "Unexpected response shape" };
  }
  log.info({ method, path, status: resp.status }, "voizo.request.ok");
  return { ok: true, data: parsed.data };
}

/** Can we dial right now? (window open, quota left, nothing in flight). Places no call. */
export function getStatus(): Promise<VoizoResult<VoizoStatus>> {
  return request("GET", "/api/v1/status", StatusSchema);
}

interface DialInput {
  phone: string;
  name?: string | null;
  clientRef?: string;
  /** The Voizo script (campaign) the operator picked in Call with AI; omitted = Voizo's default script. */
  campaignId?: string | null;
  /** Lead details for the script's {{tokens}} (Voizo whitelist: business, category, offer, event, booth). */
  variables?: Record<string, string> | null;
}

/** The POST body for one call. Pure. */
export function dialBody(input: DialInput): Record<string, unknown> {
  return {
    phone: input.phone,
    ...(input.name ? { name: input.name.slice(0, 120) } : {}),
    ...(input.clientRef ? { clientRef: input.clientRef.slice(0, 200) } : {}),
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    ...(input.variables && Object.keys(input.variables).length ? { variables: input.variables } : {}),
  };
}

/** Dial one number. 202 = handed to the carrier (not yet answered). Not retried — see header. */
export function placeCall(input: DialInput): Promise<VoizoResult<VoizoDial>> {
  return request("POST", "/api/v1/calls", DialSchema, dialBody(input));
}

/** Poll one call. Ask for the transcript only once, on the fetch where `done` is first true. */
export function getCall(
  callId: string,
  opts: { transcript?: boolean } = {},
): Promise<VoizoResult<VoizoCall>> {
  const q = opts.transcript ? "?include=transcript" : "";
  return request("GET", `/api/v1/calls/${encodeURIComponent(callId)}${q}`, CallSchema);
}

const TestCallSchema = z.object({
  ok: z.boolean().optional(),
  publicKey: z.string(),
  assistantId: z.string(),
  /** Passed to Vapi UNCHANGED: its metadata is how Voizo recognises the call and fills the script's tokens. */
  assistantOverrides: z.record(z.unknown()),
  sessionId: z.string(),
  expiresAt: z.string().nullish(),
});
export type VoizoTestCall = z.infer<typeof TestCallSchema>;

/**
 * A browser test session for the voice agent (no number is dialled). Reusable until it expires (30 min, Voizo 20 Nov 2026); we still mint one per Start press.
 * Not retried (a lost response would only waste one of the 50 daily sessions).
 */
export function startTestCall(input: {
  name?: string | null;
  variables?: Record<string, string> | null;
  /** The offer's script (GET /api/v1/scripts); omitted = Voizo's default campaign. */
  campaignId?: string | null;
}): Promise<VoizoResult<VoizoTestCall>> {
  return request("POST", "/api/v1/test-calls", TestCallSchema, {
    ...(input.name ? { name: input.name.slice(0, 120) } : {}),
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    ...(input.variables && Object.keys(input.variables).length ? { variables: input.variables } : {}),
  });
}

const ScriptsSchema = z.object({
  scripts: z.array(
    z.object({
      campaignId: z.string(),
      offerKey: z.string().nullish(),
      name: z.string().nullish(),
      scriptId: z.string().nullish(),
      scriptVariables: z.array(z.string()).nullish(),
      canDial: z.boolean().nullish(),
    }),
  ),
});
export type VoizoScripts = z.infer<typeof ScriptsSchema>;

/** The API campaigns our key may use, one per offer (free; GET retried on 5xx). */
export function listScripts(): Promise<VoizoResult<VoizoScripts>> {
  return request("GET", "/api/v1/scripts", ScriptsSchema);
}

/* ------------------------------------------------------------------ training (wording changes to a script) ----- */

const LinesSchema = z.union([z.string(), z.array(z.string())]);
const TrainEditSchema = z.object({ label: z.string(), before: LinesSchema, after: LinesSchema });
const TrainSchema = z.object({
  reply: z.string(),
  proposal: z.object({ id: z.string(), expiresAt: z.string().nullish(), edits: z.array(TrainEditSchema) }).nullish(),
});
export type VoizoTrainReply = z.infer<typeof TrainSchema>;

const ApplySchema = z.object({ changeId: z.string(), appliedAt: z.string().nullish(), edits: z.number().nullish() });
export type VoizoTrainApplied = z.infer<typeof ApplySchema>;

const UndoSchema = z.object({ undone: z.boolean() });

const ChangesSchema = z.object({
  changes: z.array(
    z.object({
      id: z.string(),
      instruction: z.string().nullish(),
      summary: z.string().nullish(),
      actor: z.string().nullish(),
      appliedAt: z.string().nullish(),
      undoneAt: z.string().nullish(),
      edits: z.array(TrainEditSchema).nullish(),
    }),
  ),
});
export type VoizoTrainChanges = z.infer<typeof ChangesSchema>;

const scriptPath = (campaignId: string) => `/api/v1/scripts/${encodeURIComponent(campaignId)}`;

/**
 * Ask Voizo to turn a plain instruction ("don't mention price on the first call") into wording changes for one
 * offer's script. PROPOSES ONLY: nothing changes until applyTraining. One OpenAI call on Voizo's side, so it gets
 * a longer timeout; never retried (a second proposal would just replace the first).
 */
export function trainScript(
  campaignId: string,
  input: { instruction: string; history?: { role: "user" | "assistant"; text: string }[]; actor?: string | null },
): Promise<VoizoResult<VoizoTrainReply>> {
  return request(
    "POST",
    `${scriptPath(campaignId)}/train`,
    TrainSchema,
    {
      instruction: input.instruction,
      ...(input.history?.length ? { history: input.history } : {}),
      ...(input.actor ? { actor: input.actor } : {}),
    },
    55_000,
  );
}

/** Save a proposal: the script changes now (live for the next test call and dial). Not retried. */
export function applyTraining(campaignId: string, proposalId: string): Promise<VoizoResult<VoizoTrainApplied>> {
  return request("POST", `${scriptPath(campaignId)}/train/${encodeURIComponent(proposalId)}/apply`, ApplySchema);
}

/** Put the script back to how it was before one saved change. Not retried. */
export function undoTraining(campaignId: string, changeId: string): Promise<VoizoResult<{ undone: boolean }>> {
  return request("POST", `${scriptPath(campaignId)}/changes/${encodeURIComponent(changeId)}/undo`, UndoSchema);
}

/** The script's recent saved changes, newest first (free; GET retried on 5xx). */
export function listTrainingChanges(campaignId: string, limit = 20): Promise<VoizoResult<VoizoTrainChanges>> {
  return request("GET", `${scriptPath(campaignId)}/changes?limit=${limit}`, ChangesSchema);
}
