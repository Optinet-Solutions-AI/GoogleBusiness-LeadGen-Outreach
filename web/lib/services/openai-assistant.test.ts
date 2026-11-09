/**
 * openai-assistant.test.ts — the assistant call: switched off without a key, clear errors, scoped answers.
 *
 * Inputs:  a mocked fetch returning Responses-API shaped bodies
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  OPENAI_API_KEY: "",
  OPENAI_ASSISTANT_MODEL: "gpt-5.4-mini",
  OPENAI_CONTACT_USD_PER_MTOK_IN: 0.75,
  OPENAI_CONTACT_USD_PER_MTOK_OUT: 4.5,
}));
vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/config", () => ({ env }));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
vi.mock("@/lib/retry", () => ({ retry: (fn: () => Promise<unknown>) => fn() }));

import { AssistantError, askAssistant, classifyOpenAiError, isAssistantConfigured } from "./openai-assistant";
import { OFF_TOPIC_REPLY } from "@/lib/assistant/prompt";

const reply = (answer: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
      usage: { input_tokens: 8000, output_tokens: 300 },
    }),
    { status },
  );

afterEach(() => {
  vi.unstubAllGlobals();
  env.OPENAI_API_KEY = "";
});

describe("openai-assistant", () => {
  it("is off without a key and never calls OpenAI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(isAssistantConfigured()).toBe(false);
    await expect(askAssistant({ question: "How do I build a site?" })).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the guide, the English rule and the strict schema, and returns the answer", async () => {
    env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn().mockResolvedValue(reply({ in_scope: true, answer: "1. Open [Leads](/leads)" }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await askAssistant({ question: "איך בונים אתר?", page: "/leads/1" });
    expect(out.answer).toBe("1. Open [Leads](/leads)");
    expect(out.in_scope).toBe(true);
    expect(out.usd).toBeGreaterThan(0);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe("gpt-5.4-mini");
    expect(sent.instructions).toMatch(/in English/);
    expect(sent.text.format.strict).toBe(true);
    expect(sent.tools).toBeUndefined();
  });

  it("replaces an off-topic answer with the fixed reply", async () => {
    env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ in_scope: false, answer: "The weather is sunny" })));
    expect((await askAssistant({ question: "What's the weather?" })).answer).toBe(OFF_TOPIC_REPLY);
  });

  it("maps OpenAI errors to clear codes", async () => {
    expect(classifyOpenAiError(401, '{"error":{"code":"expired_secret_key"}}')).toBe("key_invalid");
    expect(classifyOpenAiError(429, '{"error":{"code":"insufficient_quota"}}')).toBe("no_credit");
    expect(classifyOpenAiError(400, "bad request")).toBe("failed");
    env.OPENAI_API_KEY = "sk-old";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"code":"expired_secret_key"}}', { status: 401 })));
    const err = await askAssistant({ question: "hi" }).catch((e) => e);
    expect(err).toBeInstanceOf(AssistantError);
    expect(err.code).toBe("key_invalid");
  });
});
