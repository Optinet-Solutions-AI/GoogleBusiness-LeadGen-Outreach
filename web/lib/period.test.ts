import { describe, it, expect } from "vitest";
import { resolvePeriod, parsePeriod, parseOffset } from "./period";

// Wed 2026-06-17 → ISO week starts Mon 2026-06-15 (= 2026-W25); month June; year 2026.
const NOW = new Date("2026-06-17T12:00:00Z");

describe("parsePeriod", () => {
  it("defaults unknown/missing to week", () => {
    expect(parsePeriod(undefined)).toBe("week");
    expect(parsePeriod("junk")).toBe("week");
  });
  it("accepts month and year", () => {
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod("year")).toBe("year");
  });
});

describe("parseOffset", () => {
  it("defaults to 0 and caps the future at 0", () => {
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset("x")).toBe(0);
    expect(parseOffset("3")).toBe(0); // future is always empty
  });
  it("keeps negative offsets", () => {
    expect(parseOffset("-2")).toBe(-2);
  });
});

describe("resolvePeriod", () => {
  it("resolves the current week", () => {
    const r = resolvePeriod("week", 0, NOW);
    expect(r.start).toBe("2026-06-15T00:00:00.000Z");
    expect(r.end).toBe("2026-06-22T00:00:00.000Z");
    expect(r.label).toBe("Week 2026-W25");
    expect(r.isCurrent).toBe(true);
  });
  it("resolves the previous week", () => {
    const r = resolvePeriod("week", -1, NOW);
    expect(r.start).toBe("2026-06-08T00:00:00.000Z");
    expect(r.end).toBe("2026-06-15T00:00:00.000Z");
    expect(r.label).toBe("Week 2026-W24");
    expect(r.isCurrent).toBe(false);
  });
  it("resolves the current and previous month", () => {
    const cur = resolvePeriod("month", 0, NOW);
    expect(cur.start).toBe("2026-06-01T00:00:00.000Z");
    expect(cur.end).toBe("2026-07-01T00:00:00.000Z");
    expect(cur.label).toBe("June 2026");
    const prev = resolvePeriod("month", -1, NOW);
    expect(prev.start).toBe("2026-05-01T00:00:00.000Z");
    expect(prev.label).toBe("May 2026");
  });
  it("resolves the current year", () => {
    const r = resolvePeriod("year", 0, NOW);
    expect(r.start).toBe("2026-01-01T00:00:00.000Z");
    expect(r.end).toBe("2027-01-01T00:00:00.000Z");
    expect(r.label).toBe("2026");
  });
});
