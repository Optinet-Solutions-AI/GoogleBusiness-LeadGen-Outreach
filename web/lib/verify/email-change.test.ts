/**
 * email-change.test.ts — a changed email address never inherits the old address's check result.
 *
 * Inputs:  pairs of addresses
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { verificationResetFor, sameEmail } from "./email-change";

describe("verificationResetFor", () => {
  it("clears the old verdict when the address changes", () => {
    const r = verificationResetFor("owner@gmail.com", "nobody@nodomain-xyz.com");
    expect(r).toMatchObject({ verification_status: null, email_verified: false, verified_at: null, verify_zerobounce_result: null });
  });
  it("clears it when the address is removed or added", () => {
    expect(verificationResetFor("owner@gmail.com", null)).toHaveProperty("verification_status", null);
    expect(verificationResetFor(null, "owner@gmail.com")).toHaveProperty("verification_status", null);
  });
  it("keeps it when only case or spaces differ", () => {
    expect(verificationResetFor("Owner@Gmail.com", " owner@gmail.com ")).toEqual({});
    expect(sameEmail(null, "")).toBe(true);
  });
});
