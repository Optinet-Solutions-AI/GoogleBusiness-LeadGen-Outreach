/**
 * enroll-lead.test.ts — Send outreach checks a never-checked address before starting the sequence.
 *
 * Inputs:  fake load / verify / enroll deps
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/verify/verify-lead", () => ({ verifyLead: vi.fn() }));
vi.mock("@/lib/services/email-validator", () => ({ verificationActive: () => true }));
vi.mock("@/lib/pipeline/sequence-scheduler", () => ({ enrollLeadInSequence: vi.fn() }));

import { enrollWithVerification, needsCheck, type EnrollDeps } from "./enroll-lead";

function deps(status: string | null, verified: string | null, opts: { on?: boolean; email?: string | null } = {}) {
  const d: EnrollDeps = {
    load: vi.fn().mockResolvedValue({ id: "L1", email: opts.email === undefined ? "a@b.com" : opts.email, verification_status: status }),
    verify: vi.fn().mockResolvedValue(verified ? { status: verified } : null),
    enroll: vi.fn().mockResolvedValue({ enrolled: true }),
    verificationOn: () => opts.on ?? true,
  };
  return d;
}

describe("enrollWithVerification", () => {
  it("checks a never-checked or unknown address, then enrolls", async () => {
    for (const s of [null, "unknown"]) {
      const d = deps(s, "valid");
      const r = await enrollWithVerification("L1", d);
      expect(d.verify).toHaveBeenCalledWith({ id: "L1", email: "a@b.com" });
      expect(r).toEqual({ enrolled: true, verification: "valid", checked: true });
      expect(d.enroll).toHaveBeenCalledAfter(d.verify as never);
    }
  });

  it("never re-checks a decided address", async () => {
    for (const s of ["valid", "catch-all", "invalid"]) {
      const d = deps(s, "valid");
      const r = await enrollWithVerification("L1", d);
      expect(d.verify).not.toHaveBeenCalled();
      expect(r.verification).toBe(s);
      expect(r.checked).toBe(false);
    }
  });

  it("skips the check with no email or verification switched off", async () => {
    const noEmail = deps(null, "valid", { email: null });
    await enrollWithVerification("L1", noEmail);
    expect(noEmail.verify).not.toHaveBeenCalled();
    const off = deps(null, "valid", { on: false });
    await enrollWithVerification("L1", off);
    expect(off.verify).not.toHaveBeenCalled();
  });

  it("still enrolls (and reports the old status) when the check itself fails", async () => {
    const d = deps(null, null);
    const r = await enrollWithVerification("L1", d);
    expect(r).toEqual({ enrolled: true, verification: null, checked: false });
  });

  it("needsCheck", () => {
    expect(needsCheck(null)).toBe(true);
    expect(needsCheck("unknown")).toBe(true);
    expect(needsCheck("valid")).toBe(false);
  });
});
