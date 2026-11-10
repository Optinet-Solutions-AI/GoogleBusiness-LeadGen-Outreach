/**
 * enroll-messages.test.ts — every enroll refusal reason reads as an instruction.
 *
 * Inputs:  reason codes
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { enrollRefusalText, enrollToast } from "./enroll-messages";

describe("enrollRefusalText", () => {
  it("explains each known reason", () => {
    expect(enrollRefusalText("no_demo")).toMatch(/Build the demo website first/);
    expect(enrollRefusalText("unverified")).toMatch(/failed verification/);
    expect(enrollRefusalText("already_active")).toMatch(/already in the email sequence/);
    expect(enrollRefusalText("no_email")).toMatch(/no email/);
    expect(enrollRefusalText("suppressed")).toMatch(/unsubscribed/);
  });

  it("falls back for an unknown reason", () => {
    expect(enrollRefusalText("weird")).toBe("Can't start the email sequence (weird).");
    expect(enrollRefusalText(undefined)).toMatch(/unknown reason/);
  });
});

describe("enrollToast", () => {
  it("is a success for a sendable address and a warning otherwise", () => {
    expect(enrollToast("valid").tone).toBe("success");
    expect(enrollToast("catch-all").tone).toBe("success");
    expect(enrollToast("unknown").tone).toBe("warning");
    expect(enrollToast(null).tone).toBe("warning");
  });
});
