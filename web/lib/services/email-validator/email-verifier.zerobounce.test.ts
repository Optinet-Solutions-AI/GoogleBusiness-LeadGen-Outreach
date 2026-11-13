import { describe, it, expect } from "vitest";
import { mapZeroBounce, zeroBounceErrorRaw } from "./email-verifier.zerobounce";

describe("zeroBounceErrorRaw", () => {
  it("names an empty account so the operator is told the checker is out of credits", () => {
    expect(zeroBounceErrorRaw("Invalid API Key or your account ran out of credits")).toBe("no_credits");
    expect(zeroBounceErrorRaw("something else")).toBe("error");
    expect(zeroBounceErrorRaw(undefined)).toBe("error");
  });
});

describe("mapZeroBounce", () => {
  const cases: [string, string | undefined, string][] = [
    ["valid", undefined, "valid"],
    ["invalid", undefined, "invalid"],
    ["catch-all", undefined, "catch-all"],
    ["spamtrap", undefined, "invalid"],
    ["abuse", undefined, "invalid"],
    ["toxic", undefined, "unknown"],
    ["do_not_mail", "other", "catch-all"],
    ["do_not_mail", "global_suppression", "invalid"],
    ["do_not_mail", "possible_trap", "invalid"],
    ["unknown", undefined, "unknown"],
  ];
  it.each(cases)("%s/%s → %s", (status, sub, expected) => {
    expect(mapZeroBounce(status, sub)).toBe(expected);
  });
});
