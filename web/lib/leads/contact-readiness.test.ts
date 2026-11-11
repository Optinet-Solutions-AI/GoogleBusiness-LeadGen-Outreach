/**
 * contact-readiness.test.ts — the email / call verdicts shown on leads.
 *
 * Inputs:  lead contact fields
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { callBlock, contactReadiness, emailState } from "./contact-readiness";

const base = { email: "a@b.com", verification_status: null, phone: "+1 555 0100", country_code: "us" };

describe("emailState", () => {
  it("maps verification to a plain state", () => {
    expect(emailState({ email: null, verification_status: null })).toBe("none");
    expect(emailState({ email: "a@b.com", verification_status: null })).toBe("unchecked");
    expect(emailState({ email: "a@b.com", verification_status: "unknown" })).toBe("unchecked");
    expect(emailState({ email: "a@b.com", verification_status: "valid" })).toBe("ready");
    expect(emailState({ email: "a@b.com", verification_status: "catch-all" })).toBe("catch_all");
    expect(emailState({ email: "a@b.com", verification_status: "invalid" })).toBe("bad");
  });
});

describe("callBlock", () => {
  it("allows a US lead with a phone", () => {
    expect(callBlock(base)).toBeNull();
  });
  it("blocks no phone, GDPR countries, DNC, bad numbers and finished outcomes", () => {
    expect(callBlock({ ...base, phone: null })).toMatch(/No phone/);
    expect(callBlock({ ...base, country_code: "mt" })).toMatch(/GDPR/);
    expect(callBlock({ ...base, country_code: "GB" })).toMatch(/GDPR/);
    expect(callBlock({ ...base, lifecycle_stage: "dnc" })).toMatch(/not to be called/);
    expect(callBlock({ ...base, call_status: "bad_number" })).toMatch(/wrong/);
    expect(callBlock({ ...base, call_status: "not_interested" })).toMatch(/not interested/i);
    expect(callBlock({ ...base, call_status: "qualified" })).toMatch(/Already interested/);
  });
});

describe("contactReadiness", () => {
  it("bundles the verdicts", () => {
    const r = contactReadiness({ ...base, verification_status: "invalid", contact_owner_name: "Sam" });
    expect(r.canEmail).toBe(false);
    expect(r.email.label).toBe("Bad address");
    expect(r.callBlock).toBeNull();
    expect(r.hasOwner).toBe(true);
    expect(contactReadiness(base).canEmail).toBe(true);
  });
});
