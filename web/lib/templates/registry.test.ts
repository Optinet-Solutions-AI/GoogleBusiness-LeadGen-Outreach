import { describe, it, expect } from "vitest";
import { TEMPLATE_DESIGNS, listDesigns, isValidDesign, defaultDesign } from "./registry";

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
