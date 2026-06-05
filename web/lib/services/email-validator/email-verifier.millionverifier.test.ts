import { describe, it, expect } from "vitest";
import { mapMillionVerifier } from "./email-verifier.millionverifier";

describe("mapMillionVerifier", () => {
  it.each([
    ["ok", "valid"],
    ["invalid", "invalid"],
    ["catch_all", "catch-all"],
    ["disposable", "unknown"],
    ["unknown", "unknown"],
    ["", "unknown"],
  ] as [string, string][])("%s → %s", (r, exp) => {
    expect(mapMillionVerifier(r)).toBe(exp);
  });
});
