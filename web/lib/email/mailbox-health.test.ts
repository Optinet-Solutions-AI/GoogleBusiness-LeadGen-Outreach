import { describe, expect, it } from "vitest";
import { healthVerdict, tallyMailbox, windowDays, windowStart, type HealthEvent, type HealthSend } from "./mailbox-health";

const NOW = new Date("2026-12-10T12:00:00Z");
const S = (lead_id: string, from: string, at: string): HealthSend => ({ lead_id, from, at });
const B = (lead_id: string, at: string, kind: "bounce" | "complaint" = "bounce"): HealthEvent => ({ lead_id, kind, at });

describe("mailbox health", () => {
  it("window: 7 days, or since the last Resume when that's later", () => {
    expect(windowStart(NOW, null).toISOString()).toBe("2026-12-03T12:00:00.000Z");
    expect(windowStart(NOW, "2026-12-09T00:00:00Z").toISOString()).toBe("2026-12-09T00:00:00.000Z");
    expect(windowStart(NOW, "2026-11-01T00:00:00Z").toISOString()).toBe("2026-12-03T12:00:00.000Z");
  });

  it("a bounce belongs to the mailbox that sent the lead's last email before it; once per lead", () => {
    const since = windowStart(NOW, null);
    const sends = [S("a", "Grace@x.com", "2026-12-04T00:00:00Z"), S("a", "ethan@y.com", "2026-12-05T00:00:00Z"), S("b", "grace@x.com", "2026-12-05T00:00:00Z")];
    const events = [B("a", "2026-12-06T00:00:00Z"), B("a", "2026-12-06T00:10:00Z"), B("b", "2026-12-06T00:00:00Z"), B("c", "2026-12-06T00:00:00Z")];
    expect(tallyMailbox("grace@x.com", since, sends, events)).toEqual({ sent: 2, bounces: 1, complaints: 0 });
    expect(tallyMailbox("ethan@y.com", since, sends, events)).toEqual({ sent: 1, bounces: 1, complaints: 0 });
  });

  it("after a Resume, older sends and bounces don't count", () => {
    const since = windowStart(NOW, "2026-12-08T00:00:00Z");
    const sends = [S("a", "g@x.com", "2026-12-04T00:00:00Z"), S("b", "g@x.com", "2026-12-09T00:00:00Z")];
    expect(tallyMailbox("g@x.com", since, sends, [B("a", "2026-12-05T00:00:00Z")])).toEqual({ sent: 1, bounces: 0, complaints: 0 });
  });

  it("a send before the window still owns a bounce inside it", () => {
    const since = windowStart(NOW, null);
    expect(tallyMailbox("g@x.com", since, [S("a", "g@x.com", "2026-12-01T00:00:00Z")], [B("a", "2026-12-04T00:00:00Z")])).toEqual({ sent: 0, bounces: 1, complaints: 0 });
  });

  it("complaints are counted the same way", () => {
    const since = windowStart(NOW, null);
    const sends = [S("a", "g@x.com", "2026-12-04T00:00:00Z"), S("b", "g@x.com", "2026-12-04T00:00:00Z")];
    expect(tallyMailbox("g@x.com", since, sends, [B("a", "2026-12-05T00:00:00Z", "complaint"), B("b", "2026-12-05T00:00:00Z", "complaint")])).toEqual({ sent: 2, bounces: 0, complaints: 2 });
  });

  it("verdict: bounces need 20 sends, 5% and 2 bounces; complaints need 2", () => {
    expect(healthVerdict({ sent: 19, bounces: 5, complaints: 0 }, 7)).toEqual({ pause: false });
    expect(healthVerdict({ sent: 40, bounces: 1, complaints: 0 }, 7)).toEqual({ pause: false });
    expect(healthVerdict({ sent: 60, bounces: 2, complaints: 0 }, 7)).toEqual({ pause: false }); // 3%
    expect(healthVerdict({ sent: 31, bounces: 4, complaints: 0 }, 7)).toEqual({ pause: true, reason: "4 hard bounces out of 31 emails in the last 7 days (13%)" });
    expect(healthVerdict({ sent: 3, bounces: 0, complaints: 2 }, 7)).toEqual({ pause: true, reason: "2 spam complaints in the last 7 days" });
    expect(healthVerdict({ sent: 3, bounces: 0, complaints: 1 }, 7)).toEqual({ pause: false });
  });

  it("windowDays", () => {
    expect(windowDays(NOW, windowStart(NOW, null))).toBe(7);
    expect(windowDays(NOW, new Date("2026-12-10T06:00:00Z"))).toBe(1);
  });
});
