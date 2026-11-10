/**
 * openai-assistant.ts — ask OpenAI one in-app help question (scoped to the RateUp app, answer in English).
 *
 * Inputs:  { question, history?, page? }
 * Outputs: { answer, in_scope, usd } — or throws AssistantError (code "not_configured" | "key_invalid" | "no_credit" | "failed")
 * Used by: app/api/assistant/route.ts
 *
 * Responses API, no tools (the assistant only reads its guide), strict JSON answer schema, low reasoning effort so
 * replies come back in a few seconds. Uses OPENAI_API_KEY + OPENAI_ASSISTANT_MODEL. Cost ≈ well under 1 cent a
 * question (the guide is the same prefix each time, so OpenAI's prompt cache makes repeats cheaper).
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { retry } from "@/lib/retry";
import { classifyOpenAiFailure, recordOpenAiResult, shouldRetryOpenAi } from "./openai-health";
import { ANSWER_SCHEMA, buildInput, buildInstructions, parseAnswer, type ChatTurn } from "@/lib/assistant/prompt";

const log = getLogger("openai-assistant");
const URL_RESPONSES = "https://api.openai.com/v1/responses";

export type AssistantErrorCode = "not_configured" | "key_invalid" | "no_credit" | "failed";

export class AssistantError extends Error {
  constructor(public code: AssistantErrorCode, message: string) {
    super(message);
  }
}

export function isAssistantConfigured(): boolean {
  return env.OPENAI_API_KEY.trim().length > 0;
}

/** Turn an OpenAI error status + body into our error code. Pure. */
export function classifyOpenAiError(status: number, body: string): AssistantErrorCode {
  const s = classifyOpenAiFailure(status, body);
  return s === "key_invalid" || s === "no_credit" ? s : "failed";
}

export async function askAssistant(q: { question: string; history?: ChatTurn[]; page?: string | null }): Promise<{
  answer: string;
  in_scope: boolean;
  usd: number;
}> {
  if (!isAssistantConfigured()) throw new AssistantError("not_configured", "OPENAI_API_KEY missing");
  const started = Date.now();
  const res = await retry(
    async () => {
      const r = await fetch(URL_RESPONSES, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENAI_ASSISTANT_MODEL,
          instructions: buildInstructions(),
          input: buildInput(q.question, q.history, q.page),
          reasoning: { effort: "low" },
          max_output_tokens: 1500,
          store: false,
          text: { format: { type: "json_schema", name: "assistant_answer", schema: ANSWER_SCHEMA, strict: true } },
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
    const code = classifyOpenAiError(res.status, text);
    log.warn({ status: res.status, code, ms: Date.now() - started }, "openai_assistant.error");
    if (code === "key_invalid" || code === "no_credit") await recordOpenAiResult(code, "assistant");
    throw new AssistantError(code, `openai assistant ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as Parameters<typeof parseAnswer>[0] & {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const out = parseAnswer(body);
  const usd =
    Math.round(
      (((body.usage?.input_tokens ?? 0) / 1e6) * env.OPENAI_CONTACT_USD_PER_MTOK_IN +
        ((body.usage?.output_tokens ?? 0) / 1e6) * env.OPENAI_CONTACT_USD_PER_MTOK_OUT) *
        1e5,
    ) / 1e5;
  log.info({ in_scope: out.in_scope, usd, ms: Date.now() - started }, "openai_assistant.done");
  return { ...out, usd };
}
