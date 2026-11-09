/**
 * enroll-messages.test.ts — every enroll refusal reason reads as an instruction.
 *
 * Inputs:  reason codes
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { enrollRefusalText } from "./enroll-messages";

describe("enrollRefusalText", () => {
  it("explains each known reason", () => {
    expect(enrollRefusalText("no_demo")).toMatch(/Build the demo website first/);
    expect(enrollRefusalText("unverified")).toMatch(/Reverify/);
    expect(enrollRefusalText("already_active")).toMatch(/already in the email sequence/);
    expect(enrollRefusalText("no_email")).toMatch(/no email/);
    expect(enrollRefusalText("suppressed")).toMatch(/unsubscribed/);
  });

  it("falls back for an unknown reason", () => {
    expect(enrollRefusalText("weird")).toBe("Can't start the email sequence (weird).");
    expect(enrollRefusalText(undefined)).toMatch(/unknown reason/);
  });
});
