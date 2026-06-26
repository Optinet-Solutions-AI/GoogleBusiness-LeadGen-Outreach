import { describe, it, expect } from "vitest";
import { nextSlot, isWithinWindow, staggerSends, type SendWindow } from "./send-window";

// Helper: the wall-clock hour + ISO weekday of a Date in a given tz.
function partsIn(d: Date, tz: string): { hour: number; iso: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", hour12: false,
  });
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const parts = f.formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")!.value;
  const hr = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  return { hour: hr, iso: map[wd] };
}

const WINDOW: SendWindow = {
  tz: "America/New_York",
  days: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17,
};

describe("isWithinWindow", () => {
  // WINDOW: Mon-Fri, 09:00-17:00 America/New_York (UTC-4 in summer).
  // 2026-06-22 is a Monday.

  it("returns true for a date inside the window", () => {
    // Monday 14:00 ET = 18:00 UTC
    const d = new Date("2026-06-22T18:00:00Z");
    expect(isWithinWindow(d, WINDOW)).toBe(true);
  });

  it("returns false for a wrong day (Saturday)", () => {
    // Saturday 14:00 ET = 18:00 UTC
    const d = new Date("2026-06-27T18:00:00Z");
    expect(isWithinWindow(d, WINDOW)).toBe(false);
  });

  it("returns false before startHour", () => {
    // Monday 08:00 ET = 12:00 UTC (before 09:00)
    const d = new Date("2026-06-22T12:00:00Z");
    expect(isWithinWindow(d, WINDOW)).toBe(false);
  });

  it("returns false at endHour (exclusive)", () => {
    // Monday 17:00 ET = 21:00 UTC (endHour is exclusive)
    const d = new Date("2026-06-22T21:00:00Z");
    expect(isWithinWindow(d, WINDOW)).toBe(false);
  });

  it("returns false after endHour", () => {
    // Monday 18:00 ET = 22:00 UTC
    const d = new Date("2026-06-22T22:00:00Z");
    expect(isWithinWindow(d, WINDOW)).toBe(false);
  });

  it("uses the window timezone (same UTC instant, different local time)", () => {
    // 2026-06-22T22:00Z = Monday 18:00 ET (after 17:00, out of window)
    //                   = Tuesday 08:00 AEST (before 09:00, also out)
    const dET = new Date("2026-06-22T22:00:00Z");
    expect(isWithinWindow(dET, WINDOW)).toBe(false);
    // 2026-06-22T13:00Z = Monday 09:00 ET (in window)
    const dIn = new Date("2026-06-22T13:00:00Z");
    expect(isWithinWindow(dIn, WINDOW)).toBe(true);
  });
});

describe("nextSlot", () => {
  it("lands inside the window in the target timezone", () => {
    // A Sunday 03:00 UTC base — must roll forward to a weekday 9-17 ET.
    const after = new Date("2026-06-21T03:00:00Z"); // Sunday
    const slot = nextSlot({ after, window: WINDOW, seed: "lead1" });
    const { hour, iso } = partsIn(slot, WINDOW.tz);
    expect(WINDOW.days).toContain(iso);
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThan(17);
    expect(slot.getTime()).toBeGreaterThanOrEqual(after.getTime());
  });

  it("is deterministic for the same seed", () => {
    const after = new Date("2026-06-22T08:00:00Z");
    const a = nextSlot({ after, window: WINDOW, seed: "x" });
    const b = nextSlot({ after, window: WINDOW, seed: "x" });
    expect(a.getTime()).toBe(b.getTime());
  });

  it("keeps a base time already inside the window (adds only jitter)", () => {
    // Monday 14:00 ET = 18:00 UTC.
    const after = new Date("2026-06-22T18:00:00Z");
    const slot = nextSlot({ after, window: WINDOW, seed: "y", jitterMinMin: 5, jitterMaxMin: 10 });
    const { hour, iso } = partsIn(slot, WINDOW.tz);
    expect(iso).toBe(1);
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThan(17);
  });
});

describe("staggerSends", () => {
  const after = new Date("2026-06-22T13:00:00Z"); // Monday 09:00 ET — window open

  it("spreads a batch across the window, all in-window, non-decreasing", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `lead-${i}`);
    const map = staggerSends({ ids, window: WINDOW, after, gapMinutes: 10 });
    const times = ids.map((id) => new Date(map[id]).getTime());
    // every id scheduled
    expect(Object.keys(map)).toHaveLength(30);
    // each lands inside the window
    for (const id of ids) {
      const { hour, iso } = partsIn(new Date(map[id]), WINDOW.tz);
      expect(WINDOW.days).toContain(iso);
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
    }
    // strictly ordered forward (drip, not a burst)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
    // and genuinely spread (last is well after first)
    expect(times[times.length - 1]).toBeGreaterThan(times[0]);
  });

  it("rolls overflow past the window into the next allowed day", () => {
    // 8h window, 200 leads * 30m gap = 100h of cursor → must span multiple days.
    const ids = Array.from({ length: 200 }, (_, i) => `o-${i}`);
    const map = staggerSends({ ids, window: WINDOW, after, gapMinutes: 30 });
    const firstDay = partsIn(new Date(map["o-0"]), WINDOW.tz);
    const lastDay = partsIn(new Date(map["o-199"]), WINDOW.tz);
    // still in-window weekday, but a later instant on a later day
    expect(WINDOW.days).toContain(lastDay.iso);
    expect(new Date(map["o-199"]).getTime()).toBeGreaterThan(new Date(map["o-0"]).getTime());
    expect(firstDay.hour).toBeGreaterThanOrEqual(9);
  });

  it("is deterministic", () => {
    const ids = ["a", "b", "c"];
    const m1 = staggerSends({ ids, window: WINDOW, after, gapMinutes: 15 });
    const m2 = staggerSends({ ids, window: WINDOW, after, gapMinutes: 15 });
    expect(m1).toEqual(m2);
  });
});
