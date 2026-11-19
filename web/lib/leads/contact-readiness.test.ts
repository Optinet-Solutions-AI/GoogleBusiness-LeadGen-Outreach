/**
 * contact-readiness.test.ts — the email / call verdicts shown on leads.
 *
 * Inputs:  lead contact fields
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { callBlock, contactReadiness, emailState, isNoCallCountry, noCallScript } from "./contact-readiness";

const base = { email: "a@b.com", verification_status: null, phone: "+1 555 0100", country_code: "us" };

describe("emailState", () => {
  it("maps verification to a plain state", () => {
    expect(emailState({ email: null, verification_status: null })).toBe("none");
    expect(emailState({ email: "a@b.com", verification_status: null })).toBe("unchecked");
    expect(emailState({ email: "a@b.com", verification_status: "unknown" })).toBe("unchecked");
    expect(emailState({ email: "a@b.com", verification_status: "likely" })).toBe("likely");
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
    // Europe-wide conference leads carry "eu", not a country: still never called.
    expect(callBlock({ ...base, country_code: "eu" })).toMatch(/GDPR/);
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

describe("callBlock — reputation leads", () => {
  it("refuses AI calls (no Voizo reputation script yet) by lead type or offer", () => {
    const base = { email: null, verification_status: null, phone: "+15125550100", country_code: "us" };
    expect(callBlock({ ...base, signal_type: "review_site" })).toMatch(/reputation management/);
    expect(callBlock({ ...base, primary_offer: "reputation_mgmt" })).toMatch(/reputation management/);
    expect(callBlock({ ...base, signal_type: "exhibitor" })).toBeNull();
  });
});

describe("noCallScript (shared by the call button and the call scheduler)", () => {
  it("is true for a review-site lead even before its offer was saved", () => {
    expect(noCallScript({ signal_type: "review_site", primary_offer: null })).toBe(true);
    expect(noCallScript({ signal_type: null, primary_offer: "reputation_mgmt" })).toBe(true);
    expect(noCallScript({ signal_type: "exhibitor", primary_offer: "booth_build" })).toBe(false);
    expect(noCallScript({})).toBe(false);
  });
});

describe("isNoCallCountry (the call worker's GDPR gate)", () => {
  it("blocks every EU/UK country, the all-of-Europe value, and nothing else", () => {
    for (const c of ["eu", "EU", "gr", "mt", "gb", "de", "cy", "be"]) expect(isNoCallCountry(c)).toBe(true);
    for (const c of ["us", "au", "ph", "ca", "", null]) expect(isNoCallCountry(c)).toBe(false);
  });
});
