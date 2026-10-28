import { describe, it, expect } from "vitest";
import { toE164 } from "./phone";

describe("toE164", () => {
  it("formats a US national number", () => {
    expect(toE164("(512) 555-0100", "us")).toBe("+15125550100");
  });
  it("treats (xxx) xxx-xxxx as NANP even on a lead tagged with another country", () => {
    expect(toE164("(512) 555-0100", "nz")).toBe("+15125550100");
  });
  it("keeps an international number as-is", () => {
    expect(toE164("+64 9 123 4567", "nz")).toBe("+6491234567");
    expect(toE164("+972 3-555-1234", "il")).toBe("+97235551234");
    expect(toE164("0064 9 123 4567", null)).toBe("+6491234567");
  });
  it("adds the country code and drops the trunk 0 for national numbers", () => {
    expect(toE164("09 123 4567", "nz")).toBe("+6491234567");
    expect(toE164("0412 345 678", "au")).toBe("+61412345678");
  });
  it("handles an 11-digit US number with the leading 1", () => {
    expect(toE164("1-512-555-0100", "us")).toBe("+15125550100");
  });
  it("refuses lists, empties, unknown countries and too-short numbers", () => {
    expect(toE164("(512) 555-0100, (512) 555-0101", "us")).toBeNull();
    expect(toE164("", "us")).toBeNull();
    expect(toE164(null, "us")).toBeNull();
    expect(toE164("09 123 4567", "zz")).toBeNull();
    expect(toE164("+123", null)).toBeNull();
  });
});
