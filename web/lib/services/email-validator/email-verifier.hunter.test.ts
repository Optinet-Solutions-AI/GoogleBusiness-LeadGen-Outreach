import { describe, it, expect } from "vitest";
import { mapHunter, isWebmail } from "./email-verifier.hunter";

describe("hunter helpers", () => {
  it("isWebmail", () => {
    expect(isWebmail("a@gmail.com")).toBe(true);
    expect(isWebmail("a@acme.com")).toBe(false);
  });
  it.each([
    ["invalid", "undeliverable", "invalid"],
    ["valid", "deliverable", "valid"],
    ["accept_all", "risky", "catch-all"],
    ["webmail", "risky", "unknown"],
  ] as [string, string, string][])("%s/%s → %s", (status, result, exp) => {
    expect(mapHunter(status, result)).toBe(exp);
  });
});
