import { describe, it, expect } from "vitest";
import { campaignTimezone, callableNow } from "@/lib/call-hours";

const SCHED = { call_days: [1, 2, 3, 4, 5], call_start_hour: 9, call_end_hour: 17 };

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

describe("callableNow", () => {
  // Wed 2026-06-03 14:00 UTC = 10:00 America/New_York (EDT, weekday) → inside window
  it("true inside the weekday window", () => {
    const now = new Date("2026-06-03T14:00:00Z");
    expect(callableNow({ ...SCHED, timezone: "America/New_York" }, now).callable).toBe(true);
  });
  // Wed 2026-06-03 02:00 UTC = 22:00 EDT previous day → outside window
  it("false outside the hour window", () => {
    const now = new Date("2026-06-03T02:00:00Z");
    const r = callableNow({ ...SCHED, timezone: "America/New_York" }, now);
    expect(r.callable).toBe(false);
    expect(r.reason).toBe("outside_hours");
  });
  // Sat 2026-06-06 14:00 UTC → weekday 6 not in [1..5]
  it("false on a disallowed weekday", () => {
    const now = new Date("2026-06-06T14:00:00Z");
    const r = callableNow({ ...SCHED, timezone: "America/New_York" }, now);
    expect(r.callable).toBe(false);
    expect(r.reason).toBe("outside_days");
  });
  it("unknown timezone → not callable (default-safe)", () => {
    const now = new Date("2026-06-03T14:00:00Z");
    const r = callableNow({ ...SCHED, timezone: "" }, now);
    expect(r.callable).toBe(false);
    expect(r.reason).toBe("unknown_tz");
  });
});
