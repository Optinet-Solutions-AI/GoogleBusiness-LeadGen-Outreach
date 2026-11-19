import { describe, it, expect } from "vitest";
import { callCampaignOpen, campaignTimezone } from "@/lib/call-hours";

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

describe("callCampaignOpen", () => {
  // 03:00 on a Saturday in New York = outside every 9–20 weekday window.
  const night = new Date("2026-11-21T08:00:00Z");
  const camp = { timezone: "America/New_York", country_code: "us", call_days: [1, 2, 3, 4, 5], call_start_hour: 9, call_end_hour: 20 };
  it("Call with AI (Quick calls) goes out any time", () => {
    expect(callCampaignOpen({ ...camp, name: "Quick calls (AI) · US" }, night)).toBe(true);
  });
  it("CRM / bulk call campaigns keep their calling hours", () => {
    expect(callCampaignOpen({ ...camp, name: "Plumbers Austin" }, night)).toBe(false);
    expect(callCampaignOpen({ ...camp, name: "Plumbers Austin" }, new Date("2026-11-20T15:00:00Z"))).toBe(true);
  });
});
