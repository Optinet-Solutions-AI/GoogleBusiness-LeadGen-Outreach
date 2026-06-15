import { describe, it, expect } from "vitest";
import { campaignTimezone } from "@/lib/call-hours";

describe("campaignTimezone", () => {
  it("maps a known country to its representative IANA tz", () => {
    expect(campaignTimezone("us")).toBe("America/New_York");
    expect(campaignTimezone("gb")).toBe("Europe/London");
  });
  it("falls back to UTC for unknown/empty", () => {
    expect(campaignTimezone(null)).toBe("UTC");
    expect(campaignTimezone("zz")).toBe("UTC");
  });
});
