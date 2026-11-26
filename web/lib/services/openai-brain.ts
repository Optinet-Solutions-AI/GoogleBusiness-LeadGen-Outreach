/**
 * services/openai-brain.ts — the Brain's one OpenAI caller: a question in, checked JSON out (26 Nov 2026).
 *
 * Inputs:  instructions + input text + a strict JSON schema; OPENAI_API_KEY, OPENAI_BRAIN_MODEL (default gpt-5.4-mini),
 *          OPENAI_CONTACT_USD_PER_MTOK_IN / _OUT (the price used for the saved cost)
 * Outputs: { data, usd } — or throws BrainError (code "not_configured" | "key_invalid" | "no_credit" | "failed")
 * Used by: lib/brain/jobs.ts (understand a command, on Vercel), lib/brain/plan.ts (judge a lead, on Cloud Run)
 *
 * No tools, nothing stored at OpenAI. The caller validates what comes back (lib/brain/{command,rules}.ts): this file
 * only talks to the API. Retried once on a temporary error; logged with its cost.
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { retry } from "@/lib/retry";
import { classifyOpenAiFailure, recordOpenAiResult, shouldRetryOpenAi } from "./openai-health";

const log = getLogger("openai-brain");
const URL_RESPONSES = "https://api.openai.com/v1/responses";

export type BrainErrorCode = "not_configured" | "key_invalid" | "no_credit" | "failed";
export class BrainError extends Error {
  constructor(readonly code: BrainErrorCode, message: string) {
    super(message);
    this.name = "BrainError";
  }
}

export function isBrainConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

type ResponsesBody = {
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** The model's text (the JSON string) out of a Responses API body. */
export function outputText(body: ResponsesBody): string {
  return (body.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text ?? "")
    .join("");
}

export async function brainJson<T>(o: { name: string; instructions: string; input: string; schema: object; maxOutputTokens?: number }): Promise<{ data: T; usd: number }> {
  if (!isBrainConfigured()) throw new BrainError("not_configured", "OPENAI_API_KEY missing");
  const started = Date.now();
  const res = await retry(
    async () => {
      const r = await fetch(URL_RESPONSES, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENAI_BRAIN_MODEL,
          instructions: o.instructions,
          input: o.input,
          reasoning: { effort: "low" },
          max_output_tokens: o.maxOutputTokens ?? 800,
          store: false,
          text: { format: { type: "json_schema", name: o.name, schema: o.schema, strict: true } },
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (await shouldRetryOpenAi(r)) throw new Error(`openai ${r.status}`);
      return r;
    },
    { maxAttempts: 2 },
  );
  if (!res.ok) {
    const text = await res.text();
    const state = classifyOpenAiFailure(res.status, text);
    const code: BrainErrorCode = state === "key_invalid" || state === "no_credit" ? state : "failed";
    log.warn({ name: o.name, status: res.status, code, ms: Date.now() - started }, "openai_brain.error");
    if (code !== "failed") await recordOpenAiResult(code, "brain");
    throw new BrainError(code, `openai brain ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as ResponsesBody;
  const usd =
    Math.round(
      (((body.usage?.input_tokens ?? 0) / 1e6) * env.OPENAI_CONTACT_USD_PER_MTOK_IN + ((body.usage?.output_tokens ?? 0) / 1e6) * env.OPENAI_CONTACT_USD_PER_MTOK_OUT) * 1e6,
    ) / 1e6;
  let data: T;
  try {
    data = JSON.parse(outputText(body)) as T;
  } catch {
    log.warn({ name: o.name, ms: Date.now() - started }, "openai_brain.bad_json");
    throw new BrainError("failed", "openai brain: the answer was not JSON");
  }
  await recordOpenAiResult("ok", "brain");
  log.info({ name: o.name, usd, ms: Date.now() - started }, "openai_brain.done");
  return { data, usd };
}
