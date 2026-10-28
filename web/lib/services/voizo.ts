/**
 * voizo.ts — Voizo Dial API client (one AI phone call per request).
 *
 * Inputs:  VOIZO_API_KEY / VOIZO_API_BASE; a phone (E.164) + optional first name + our lead id
 * Outputs: typed { ok, data } | { ok:false, status, code, error } results — never throws
 * Used by: lib/pipeline/call-scheduler.ts, scripts/voizo-check.ts, the campaign call panel
 *
 * Endpoints: GET /api/v1/status · POST /api/v1/calls · GET /api/v1/calls/:id[?include=transcript].
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
    signal: AbortSignal.timeout(20_000),
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

/** Dial one number. 202 = handed to the carrier (not yet answered). Not retried — see header. */
export function placeCall(input: {
  phone: string;
  name?: string | null;
  clientRef?: string;
}): Promise<VoizoResult<VoizoDial>> {
  return request("POST", "/api/v1/calls", DialSchema, {
    phone: input.phone,
    ...(input.name ? { name: input.name.slice(0, 120) } : {}),
    ...(input.clientRef ? { clientRef: input.clientRef.slice(0, 200) } : {}),
  });
}

/** Poll one call. Ask for the transcript only once, on the fetch where `done` is first true. */
export function getCall(
  callId: string,
  opts: { transcript?: boolean } = {},
): Promise<VoizoResult<VoizoCall>> {
  const q = opts.transcript ? "?include=transcript" : "";
  return request("GET", `/api/v1/calls/${encodeURIComponent(callId)}${q}`, CallSchema);
}
