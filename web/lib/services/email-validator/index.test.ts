/**
 * index.test.ts — unit tests for the verification ladder orchestrator.
 *
 * Inputs:  injected stage fakes (hermetic — no network, no paid APIs)
 * Outputs: VerifyResult assertions
 * Used by: CI
 */
import { describe, it, expect } from "vitest";
import { runLadder } from "./index";

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
  it("never upgrades to valid without proof (stays unknown)", async () => {
    const r = await runLadder("a@acme.com", stages({}));
    expect(r.status).toBe("unknown");
  });
});
