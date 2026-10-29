/**
 * slots.test.ts — unit tests for month slot spreading and product assignment.
 *
 * Inputs:  month strings, product id lists
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { monthDates, spreadSlots, assignProducts } from "./slots";

const dayMs = 86_400_000;
const t = (d: string) => Date.parse(d + "T00:00:00Z");

describe("monthDates", () => {
  it("lists every day of the month", () => {
    const d = monthDates("2026-11");
    expect(d).toHaveLength(30);
    expect(d[0]).toBe("2026-11-01");
    expect(d[29]).toBe("2026-11-30");
  });
});

describe("spreadSlots", () => {
  it("returns 12 weekday dates in Nov 2026, at least 2 days apart", () => {
    const s = spreadSlots("2026-11", 3, 12);
    expect(s).toHaveLength(12);
    expect(new Set(s).size).toBe(12);
    for (const d of s) {
      expect(d.startsWith("2026-11-")).toBe(true);
      const wd = new Date(t(d)).getUTCDay();
      expect(wd).not.toBe(0);
      expect(wd).not.toBe(6);
    }
    for (let i = 1; i < s.length; i++) expect((t(s[i]) - t(s[i - 1])) / dayMs).toBeGreaterThanOrEqual(2);
  });
  it("is deterministic and sorted", () => {
    const a = spreadSlots("2026-11", 2, 6);
    expect(spreadSlots("2026-11", 2, 6)).toEqual(a);
    expect([...a].sort()).toEqual(a);
  });
  it("never exceeds the weekdays available or duplicates a day", () => {
    const s = spreadSlots("2026-11", 5, 40);
    expect(s.length).toBe(21);
    expect(new Set(s).size).toBe(s.length);
  });
  it("returns [] for count 0", () => {
    expect(spreadSlots("2026-11", 3, 0)).toEqual([]);
  });
});

describe("assignProducts", () => {
  it("never repeats a product within 7 days and nulls when blocked", () => {
    const slots = spreadSlots("2026-11", 3, 12);
    const out = assignProducts(slots, ["a", "b"]);
    expect(out).toHaveLength(12);
    expect(out.some((x) => x === null)).toBe(true);
    const last = new Map<string, number>();
    slots.forEach((d, i) => {
      const p = out[i];
      if (p === null) return;
      const prev = last.get(p);
      if (prev !== undefined) expect((t(d) - prev) / dayMs).toBeGreaterThanOrEqual(7);
      last.set(p, t(d));
    });
  });
  it("round-robins when products are plentiful", () => {
    const out = assignProducts(["2026-11-02", "2026-11-04", "2026-11-06"], ["a", "b", "c"]);
    expect(out).toEqual(["a", "b", "c"]);
  });
  it("returns nulls with no products", () => {
    expect(assignProducts(["2026-11-02"], [])).toEqual([null]);
  });
});
