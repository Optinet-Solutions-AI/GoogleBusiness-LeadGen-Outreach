import { describe, it, expect } from "vitest";
import { nextSlot, type SendWindow } from "./send-window";

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
