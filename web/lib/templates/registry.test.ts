import { describe, it, expect } from "vitest";
import { TEMPLATE_DESIGNS, listDesigns, isValidDesign, defaultDesign, resolveDesign } from "./registry";

describe("template registry", () => {
  it("has exactly 3 designs for each of the 5 focus niches", () => {
    const niches = ["auto-site", "chiropractic-site", "dental-site", "restaurant-site", "trades-site"];
    for (const n of niches) expect(listDesigns(n)).toHaveLength(3);
    expect(Object.keys(TEMPLATE_DESIGNS).sort()).toEqual([...niches].sort());
  });
  it("validates a known design and rejects an unknown one", () => {
    expect(isValidDesign("dental-site", "studio-dental")).toBe(true);
    expect(isValidDesign("dental-site", "nope")).toBe(false);
    expect(isValidDesign("unknown-niche", "studio-dental")).toBe(false);
  });
  it("defaultDesign returns the first slug, or null for unknown niche", () => {
    expect(defaultDesign("dental-site")).toBe("bright-dental-co");
    expect(defaultDesign("unknown-niche")).toBeNull();
  });
});

describe("resolveDesign precedence", () => {
  it("prefers a valid lead override", () => {
    expect(resolveDesign("dental-site", "studio-dental", "bright-dental-co")).toBe("studio-dental");
  });
  it("falls to batch default when lead override is null", () => {
    expect(resolveDesign("dental-site", null, "studio-dental")).toBe("studio-dental");
  });
  it("falls to registry default when both are null", () => {
    expect(resolveDesign("dental-site", null, null)).toBe("bright-dental-co");
  });
  it("skips an invalid override and uses the next valid source", () => {
    expect(resolveDesign("dental-site", "garbage", "studio-dental")).toBe("studio-dental");
    expect(resolveDesign("dental-site", "garbage", "garbage")).toBe("bright-dental-co");
  });
  it("returns null for an unknown niche", () => {
    expect(resolveDesign("unknown-niche", "x", "y")).toBeNull();
  });
});
