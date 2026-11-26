import { describe, expect, it } from "vitest";
import { scheduleTouches } from "./schedule";
import type { SendWindow } from "@/lib/campaigns/send-window";
import type { Channel } from "./rules";

const window: SendWindow = { tz: "America/Chicago", days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 };
const NOW = new Date("2026-11-26T15:00:00Z"); // Thursday 9:00 in Chicago
const dayIn = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: window.tz, dateStyle: "short" }).format(new Date(iso));
const hourIn = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: window.tz, hour: "numeric", hour12: false }).format(new Date(iso)));

describe("scheduleTouches", () => {
  it("a lead with an email takes its email's send time; its call is due exactly 2 days later", () => {
    const s = scheduleTouches({
      rows: [{ lead_id: "A", channels: ["email", "form", "call"] as Channel[] }],
      emailSlots: { A: "2026-11-27T16:10:00.000Z" },
      window, formsPerDay: 10, now: NOW,
    });
    expect(s.A).toEqual({ first_touch_at: "2026-11-27T16:10:00.000Z", call_due_at: "2026-11-29T16:10:00.000Z" });
  });

  it("no call ticked → no call time", () => {
    const s = scheduleTouches({ rows: [{ lead_id: "A", channels: ["email"] as Channel[] }], emailSlots: { A: "2026-11-27T16:10:00.000Z" }, window, formsPerDay: 10, now: NOW });
    expect(s.A.call_due_at).toBeNull();
  });

  it("100 leads with no email never put more than the daily number on one day, inside working hours", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ lead_id: `L${i}`, channels: ["form"] as Channel[] }));
    const s = scheduleTouches({ rows, emailSlots: {}, window, formsPerDay: 10, now: NOW });
    const perDay = new Map<string, number>();
    for (const r of rows) {
      const at = s[r.lead_id].first_touch_at;
      perDay.set(dayIn(at), (perDay.get(dayIn(at)) ?? 0) + 1);
      expect(hourIn(at)).toBeGreaterThanOrEqual(9);
      expect(hourIn(at)).toBeLessThan(18);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(10);
    expect(perDay.size).toBeGreaterThanOrEqual(10);
  });

  it("a call-only lead is spread too, and its call comes 2 days after its day 0", () => {
    const s = scheduleTouches({ rows: [{ lead_id: "A", channels: ["call"] as Channel[] }], emailSlots: {}, window, formsPerDay: 0, now: NOW });
    expect(Date.parse(s.A.call_due_at!) - Date.parse(s.A.first_touch_at)).toBe(2 * 86_400_000);
  });
});
