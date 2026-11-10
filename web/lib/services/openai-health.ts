/**
 * openai-health.ts — is OpenAI usable right now? One answer for every AI feature, so the UI can warn people.
 *
 * Inputs:  OPENAI_API_KEY; GET https://api.openai.com/v1/models (free); the `service_health` row (migration 058)
 * Outputs: OpenAiHealth { state, message }; recordOpenAiResult() writes the last real outcome
 * Used by: app/api/health/openai (banner + New batch form), lib/pipeline/stage-1-scrape.ts, and the OpenAI services
 *          (openai-contacts / openai-events / openai-assistant) which record their real outcomes
 *
 * Two signals, because neither is enough alone:
 *  - the free /v1/models probe catches a missing, expired or wrong key (cached 5 minutes);
 *  - "out of credit" only shows on a real call, so the services record their last outcome. A recorded no-credit
 *    failure counts until a later call succeeds (or for 24 h).
 * Recording never throws: no table (migration 058 not applied) just means no memory between calls.
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";

const log = getLogger("openai-health");

import { OPENAI_REASON, openAiStateMessage, type OpenAiState } from "@/lib/ai-status";

export type { OpenAiState } from "@/lib/ai-status";
export { openAiStateMessage } from "@/lib/ai-status";
export type OpenAiHealth = { state: OpenAiState; reason: string; message: string };

/** Map an OpenAI HTTP failure to a state. Pure. */
export function classifyOpenAiFailure(status: number, body: string): OpenAiState {
  if (status === 401 || /invalid_api_key|expired_secret_key|incorrect api key/i.test(body)) return "key_invalid";
  if (/insufficient_quota|billing_hard_limit|exceeded your current quota/i.test(body)) return "no_credit";
  return "unreachable";
}

let probeCache: { at: number; state: OpenAiState } | null = null;
const PROBE_TTL_MS = 5 * 60_000;

/** Free key check (lists models). Cached 5 minutes. */
export async function probeOpenAiKey(fetchImpl: typeof fetch = fetch): Promise<OpenAiState> {
  if (!env.OPENAI_API_KEY.trim()) return "missing";
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.state;
  let state: OpenAiState;
  try {
    const r = await fetchImpl("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    state = r.ok ? "ok" : classifyOpenAiFailure(r.status, await r.text().catch(() => ""));
  } catch {
    state = "unreachable";
  }
  probeCache = { at: Date.now(), state };
  if (state !== "ok") log.warn({ state }, "openai_health.probe");
  return state;
}

/** Remember the outcome of a real OpenAI call (ok, or why it failed). Never throws. */
export async function recordOpenAiResult(state: OpenAiState, where: string): Promise<void> {
  try {
    const { getDb } = await import("@/lib/db");
    await getDb()
      .from("service_health")
      .upsert({ service: "openai", ok: state === "ok", code: state, message: where, updated_at: new Date().toISOString() });
  } catch {
    /* migration 058 not applied, or no DB: nothing to remember */
  }
  if (state !== "ok") probeCache = null; // re-probe next time instead of trusting a stale "ok"
}

/** Combine the probe and the last recorded outcome. Pure. */
export function combineHealth(
  probe: OpenAiState,
  recorded: { ok: boolean; code: string | null; updated_at: string } | null,
  now = Date.now(),
): OpenAiState {
  if (probe !== "ok") return probe;
  if (recorded && !recorded.ok && recorded.code === "no_credit" && now - Date.parse(recorded.updated_at) < 24 * 3600_000) {
    return "no_credit";
  }
  return "ok";
}

export async function getOpenAiHealth(): Promise<OpenAiHealth> {
  const probe = await probeOpenAiKey();
  let recorded: { ok: boolean; code: string | null; updated_at: string } | null = null;
  if (probe === "ok") {
    try {
      const { getDb } = await import("@/lib/db");
      const { data } = await getDb().from("service_health").select("ok,code,updated_at").eq("service", "openai").maybeSingle();
      recorded = (data as typeof recorded) ?? null;
    } catch {
      /* no table yet */
    }
  }
  const state = combineHealth(probe, recorded);
  return { state, reason: OPENAI_REASON[state], message: openAiStateMessage(state) };
}

/** Thrown by OpenAI services when the key or the account (not the request) is the problem. */
export class OpenAiUnavailableError extends Error {
  constructor(public state: OpenAiState, message: string) {
    super(message);
  }
}

/** Retry a 5xx or a rate-limit 429 — never an out-of-credit 429 (retrying can't fix it). */
export async function shouldRetryOpenAi(r: Response): Promise<boolean> {
  if (r.status >= 500) return true;
  if (r.status !== 429) return false;
  const t = await r.clone().text().catch(() => "");
  return !/insufficient_quota|exceeded your current quota/i.test(t);
}

/**
 * Handle a non-OK OpenAI response: record key / credit problems and throw OpenAiUnavailableError for them,
 * or a plain Error for anything else. Always throws.
 */
export async function failOpenAi(res: Response, where: string): Promise<never> {
  const text = await res.text().catch(() => "");
  const state = classifyOpenAiFailure(res.status, text);
  if (state === "key_invalid" || state === "no_credit") {
    await recordOpenAiResult(state, where);
    throw new OpenAiUnavailableError(state, `openai ${where} ${res.status} ${state}: ${text.slice(0, 160)}`);
  }
  throw new Error(`openai ${where} ${res.status}: ${text.slice(0, 200)}`);
}
