import { describe, it, expect } from "vitest";
import { mapZeroBounce } from "./email-verifier.zerobounce";

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
