/**
 * catch-all-probe.test.ts — unit tests for the catch-all probe stage.
 *
 * Inputs:  mocked smtp-probe module (hermetic — no network)
 * Outputs: StageResult assertions
 * Used by: CI
 */
import { describe, it, expect, vi } from "vitest";

describe("catchAllProbe", () => {
  it("returns unknown (non-decisive) when probing is disabled", async () => {
    const { catchAllProbe } = await import("./catch-all-probe");
    const r = await catchAllProbe("acme.com", "mail.acme.com", { enabled: false });
    expect(r.status).toBe("unknown");
    expect(r.decisive).toBe(false);
  });

  it("maps an accepting domain (smtp valid for a random mailbox) to catch-all", async () => {
    vi.resetModules();
    vi.doMock("./smtp-probe", () => ({
      smtpProbe: async () => ({ status: "valid", decisive: true, raw: "rcpt_250" }),
    }));
    const { catchAllProbe } = await import("./catch-all-probe");
    const r = await catchAllProbe("acme.com", "mail.acme.com", { enabled: true });
    expect(r.status).toBe("catch-all");
    expect(r.decisive).toBe(true);
    vi.doUnmock("./smtp-probe");
    vi.resetModules();
  });
});
