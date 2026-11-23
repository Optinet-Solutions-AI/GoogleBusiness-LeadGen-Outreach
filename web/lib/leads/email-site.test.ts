/**
 * email-site.test.ts — warn when the main email isn't on the business's website domain (QA 23 Nov 2026: a locksmith
 * had its web partner's address, a plumber had its web host's staging address).
 *
 * Inputs:  an email and a website
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { emailSiteMismatch } from "./email-site";

describe("emailSiteMismatch", () => {
  it("names both domains when the email is on another company's domain", () =>
    expect(emailSiteMismatch("investigations@dancogroupal.com", "http://www.chickasawlocksmith.com/")).toEqual({
      emailDomain: "dancogroupal.com",
      siteDomain: "chickasawlocksmith.com",
    }));
  it("no warning on the website's own domain, a sub-domain of it, or the other way round", () => {
    expect(emailSiteMismatch("info@discountlocksmithal.com", "https://discountlocksmithal.com/")).toBeNull();
    expect(emailSiteMismatch("memphis@1tomplumber.com", "https://www.1tomplumber.com/memphis-tn/")).toBeNull();
    expect(emailSiteMismatch("info@avantel.net", "https://memphisplumber.avantel.net/")).toBeNull();
    expect(emailSiteMismatch("office@mail.joes.com", "https://joes.com")).toBeNull();
  });
  it("no warning for a free mailbox (small businesses use Gmail) or when there's no email or website", () => {
    expect(emailSiteMismatch("satsumalocksmith@gmail.com", "https://satsumalocksmith.com/")).toBeNull();
    expect(emailSiteMismatch(null, "https://joes.com")).toBeNull();
    expect(emailSiteMismatch("info@joes.com", null)).toBeNull();
  });
  it("no warning when the 'website' is a Facebook page", () =>
    expect(emailSiteMismatch("info@joes.com", "https://facebook.com/joes")).toBeNull());
});
