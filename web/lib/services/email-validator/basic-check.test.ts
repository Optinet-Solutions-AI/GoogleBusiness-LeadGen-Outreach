/**
 * basic-check.test.ts — the free built-in address check: catches scraped junk, typo'd webmail domains, throwaway
 * and placeholder addresses before an email goes out.
 *
 * Inputs:  email strings
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { checkBasic } from "./basic-check";

describe("checkBasic", () => {
  it("passes normal business and webmail addresses (non-decisive: other checks still run)", () => {
    for (const e of ["info@joesplumbing.com", "Hannah.Porter@gmail.com", "owner@acme.co.uk"]) {
      expect(checkBasic(e), e).toEqual({ status: "unknown", decisive: false });
    }
  });

  it("rejects image and file names scraped from websites", () => {
    expect(checkBasic("logo@2x.png")).toMatchObject({ status: "invalid", decisive: true, reason: "not_an_email" });
    expect(checkBasic("hero-image@3x.webp").status).toBe("invalid");
  });

  it("rejects typo'd webmail domains", () => {
    expect(checkBasic("joe@gmial.com")).toMatchObject({ status: "invalid", reason: "typo_domain" });
    expect(checkBasic("joe@hotmial.com").status).toBe("invalid");
    expect(checkBasic("joe@gmail.con").status).toBe("invalid");
  });

  it("rejects throwaway inboxes", () => {
    expect(checkBasic("x@mailinator.com")).toMatchObject({ status: "invalid", reason: "disposable" });
    expect(checkBasic("x@YOPMAIL.com").status).toBe("invalid");
  });

  it("rejects placeholders, no-reply and website-tool addresses nobody reads", () => {
    expect(checkBasic("you@example.com")).toMatchObject({ status: "invalid", reason: "placeholder" });
    expect(checkBasic("name@domain.com").status).toBe("invalid");
    expect(checkBasic("noreply@acme.com")).toMatchObject({ status: "invalid", reason: "no_reply" });
    expect(checkBasic("do-not-reply@acme.com").status).toBe("invalid");
    expect(checkBasic("abc123@sentry.wixpress.com")).toMatchObject({ status: "invalid", reason: "placeholder" });
  });
});
