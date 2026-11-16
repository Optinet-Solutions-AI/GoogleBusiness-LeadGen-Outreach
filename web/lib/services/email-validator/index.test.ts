/**
 * index.test.ts — unit tests for the verification ladder orchestrator.
 *
 * Inputs:  injected stage fakes (hermetic — no network, no paid APIs)
 * Outputs: VerifyResult assertions
 * Used by: CI
 */
import { describe, it, expect, vi } from "vitest";
import { noCheckerAnswered, runLadder } from "./index";

const stages = (over: Partial<Parameters<typeof runLadder>[1]>) => ({
  syntax: () => ({ status: "unknown" as const, decisive: false }),
  mx: async () => ({ status: "unknown" as const, decisive: false, mxTop: "mx.acme.com", providerType: "cpanel_or_other" as const }),
  catchAll: async () => ({ status: "unknown" as const, decisive: false, raw: "disabled" }),
  smtp: async () => ({ status: "unknown" as const, decisive: false, raw: "disabled" }),
  zerobounce: async () => null,
  millionverifier: async () => null,
  hunter: async () => null,
  ...over,
});

describe("runLadder", () => {
  it("short-circuits on invalid syntax", async () => {
    const r = await runLadder("bad", stages({ syntax: () => ({ status: "invalid", decisive: true }) }));
    expect(r.status).toBe("invalid");
    expect(r.decided_by).toBe("syntax");
  });
  it("uses ZeroBounce when local stages are unknown", async () => {
    const r = await runLadder("a@acme.com", stages({ zerobounce: async () => ({ status: "valid", raw: "valid" }) }));
    expect(r.status).toBe("valid");
    expect(r.decided_by).toBe("zerobounce");
  });
  it("asks Hunter first and stops there on a clear answer (ZeroBounce not charged)", async () => {
    const zerobounce = vi.fn(async () => ({ status: "valid" as const, raw: "valid" }));
    const r = await runLadder("a@acme.com", stages({ hunter: async () => ({ status: "invalid", raw: "invalid/undeliverable" }), zerobounce }));
    expect(r.decided_by).toBe("hunter");
    expect(r.status).toBe("invalid");
    expect(zerobounce).not.toHaveBeenCalled();
  });
  it("falls back to ZeroBounce when Hunter is out of credits or rate-limited", async () => {
    const r = await runLadder("a@acme.com", stages({
      hunter: async () => ({ status: "unknown", raw: "http_429" }),
      zerobounce: async () => ({ status: "valid", raw: "valid" }),
    }));
    expect(r.decided_by).toBe("zerobounce");
    expect(r.audit.hunter_result).toBe("http_429");
  });
  it("never upgrades to valid without proof (stays unknown)", async () => {
    const r = await runLadder("a@acme.com", stages({}));
    expect(r.status).toBe("unknown");
  });

  it("giant domains skip catch-all + smtp probes and fall through to ZeroBounce", async () => {
    const catchAll = vi.fn(async () => ({ status: "unknown" as const, decisive: false, raw: "x" }));
    const smtp = vi.fn(async () => ({ status: "unknown" as const, decisive: false, raw: "x" }));
    const r = await runLadder("a@bigco.com", {
      syntax: () => ({ status: "unknown", decisive: false }),
      mx: async () => ({ status: "unknown", decisive: false, mxTop: "aspmx.l.google.com", providerType: "google_workspace" }),
      catchAll,
      smtp,
      zerobounce: async () => ({ status: "valid", raw: "valid" }),
      millionverifier: async () => null,
      hunter: async () => null,
    });
    expect(catchAll).toHaveBeenCalledTimes(0);
    expect(smtp).toHaveBeenCalledTimes(0);
    expect(r.status).toBe("valid");
    expect(r.decided_by).toBe("zerobounce");
  });
});

describe("noCheckerAnswered", () => {
  it("is true only when every checker was missing, out of credits or erroring", () => {
    expect(noCheckerAnswered({ hunter_result: "http_429", zerobounce_result: "no_credits", millionverifier_result: null })).toBe(true);
    expect(noCheckerAnswered({ hunter_result: null, zerobounce_result: "no_credits" })).toBe(true);
    expect(noCheckerAnswered({ hunter_result: "webmail/risky", zerobounce_result: "no_credits" })).toBe(false);
    expect(noCheckerAnswered({ hunter_result: "http_429", zerobounce_result: "unknown" })).toBe(false);
    expect(noCheckerAnswered(undefined)).toBe(false);
  });
});
