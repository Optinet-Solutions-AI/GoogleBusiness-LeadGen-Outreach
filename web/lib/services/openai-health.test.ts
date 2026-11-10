/**
 * openai-health.test.ts — telling "OpenAI works" from "key refused" / "out of credit", and the words for each.
 *
 * Inputs:  fake fetch responses and recorded outcomes
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ OPENAI_API_KEY: "sk-test" }));
vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/config", () => ({ env }));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("no db in tests"); } }));

import {
  classifyOpenAiFailure,
  combineHealth,
  failOpenAi,
  OpenAiUnavailableError,
  openAiStateMessage,
  probeOpenAiKey,
  shouldRetryOpenAi,
} from "./openai-health";

const res = (status: number, body = "") => new Response(body, { status });

describe("openai-health", () => {
  it("classifies failures", () => {
    expect(classifyOpenAiFailure(401, '{"error":{"code":"expired_secret_key"}}')).toBe("key_invalid");
    expect(classifyOpenAiFailure(429, '{"error":{"code":"insufficient_quota"}}')).toBe("no_credit");
    expect(classifyOpenAiFailure(429, '{"error":{"code":"rate_limit_exceeded"}}')).toBe("unreachable");
    expect(classifyOpenAiFailure(500, "")).toBe("unreachable");
  });

  it("retries rate limits and server errors, never an out-of-credit 429", async () => {
    expect(await shouldRetryOpenAi(res(503))).toBe(true);
    expect(await shouldRetryOpenAi(res(429, "rate_limit_exceeded"))).toBe(true);
    expect(await shouldRetryOpenAi(res(429, '{"error":{"code":"insufficient_quota"}}'))).toBe(false);
    expect(await shouldRetryOpenAi(res(401))).toBe(false);
  });

  it("throws OpenAiUnavailableError for key / credit problems, a plain Error otherwise", async () => {
    const e1 = await failOpenAi(res(401, "expired_secret_key"), "x").catch((e) => e);
    expect(e1).toBeInstanceOf(OpenAiUnavailableError);
    expect(e1.state).toBe("key_invalid");
    const e2 = await failOpenAi(res(400, "bad schema"), "x").catch((e) => e);
    expect(e2).not.toBeInstanceOf(OpenAiUnavailableError);
  });

  it("probes the key for free and caches the answer", async () => {
    const f = vi.fn().mockResolvedValue(res(401, "expired_secret_key"));
    expect(await probeOpenAiKey(f as unknown as typeof fetch)).toBe("key_invalid");
    expect(await probeOpenAiKey(f as unknown as typeof fetch)).toBe("key_invalid");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("reports a missing key without calling OpenAI", async () => {
    env.OPENAI_API_KEY = "";
    const f = vi.fn();
    expect(await probeOpenAiKey(f as unknown as typeof fetch)).toBe("missing");
    expect(f).not.toHaveBeenCalled();
    env.OPENAI_API_KEY = "sk-test";
  });

  it("a recent out-of-credit failure counts even when the key itself is fine", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const rec = (code: string, ok: boolean, hoursAgo: number) => ({ ok, code, updated_at: new Date(now - hoursAgo * 3600_000).toISOString() });
    expect(combineHealth("ok", rec("no_credit", false, 2), now)).toBe("no_credit");
    expect(combineHealth("ok", rec("no_credit", false, 30), now)).toBe("ok");
    expect(combineHealth("ok", rec("ok", true, 1), now)).toBe("ok");
    expect(combineHealth("key_invalid", null, now)).toBe("key_invalid");
  });

  it("explains what each state means for the user", () => {
    expect(openAiStateMessage("ok")).toBe("OpenAI is working.");
    const m = openAiStateMessage("no_credit");
    expect(m).toMatch(/out of credit/);
    expect(m).toMatch(/free website crawl only/);
    expect(m).toMatch(/assistant is off/);
  });
});
