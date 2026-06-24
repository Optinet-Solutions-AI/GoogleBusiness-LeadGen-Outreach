import { describe, it, expect } from "vitest";
import { isCategoryOffNiche, qualifies } from "@/lib/filters";

describe("isCategoryOffNiche", () => {
  // Stemmer already bridges these agent/gerund forms — must stay false.
  it.each([
    ["roofer", "Roofing contractor"],
    ["roofer", "Roofer"],
    ["plumber", "Plumber"],
    ["plumber", "Plumbing"],
    ["electrician", "Electrician"],
    ["landscaper", "Landscaping service"],
    ["painter", "Painting"],
    ["restaurant", "Restaurant"],
    ["salon", "Beauty salon"],
    ["auto repair", "Car repair"],
  ])("stem match: niche %s vs category %s → on-niche", (niche, category) => {
    expect(isCategoryOffNiche(niche, category, null)).toBe(false);
  });

  // Synonym / noun↔adjective shifts the stemmer can't bridge — these were
  // wrongly flagged before the alias map. Must be false now.
  it.each([
    ["dentist", "Dental clinic"],
    ["dental", "Dentist"],
    ["chiropractor", "Chiropractic clinic"],
    ["hvac", "Heating contractor"],
    ["hvac", "Air conditioning contractor"],
    ["electrician", "Electrical contractor"],
    ["lawyer", "Attorney"],
    ["lawyer", "Law firm"],
    ["realtor", "Real estate agency"],
    ["optometrist", "Eye care center"],
    ["veterinarian", "Veterinary care"],
    ["mechanic", "Auto repair shop"],
  ])("alias match: niche %s vs category %s → on-niche", (niche, category) => {
    expect(isCategoryOffNiche(niche, category, null)).toBe(false);
  });

  // Genuinely off-niche — no stem and no alias hit. Must stay flagged.
  it.each([
    ["plumber", "Hardware store"],
    ["dentist", "Coffee shop"],
    ["roofer", "Grocery store"],
    ["hvac", "Car repair"],
  ])("off-niche: niche %s vs category %s → flagged", (niche, category) => {
    expect(isCategoryOffNiche(niche, category, null)).toBe(true);
  });

  it("matches against the business name when category misses", () => {
    expect(isCategoryOffNiche("dentist", "Medical clinic", "Bright Dental Co")).toBe(false);
  });

  it("no niche → never flagged", () => {
    expect(isCategoryOffNiche(null, "Anything", null)).toBe(false);
  });

  it("niche is all filler → never flagged", () => {
    expect(isCategoryOffNiche("the company", "Coffee shop", null)).toBe(false);
  });
});

describe("qualifies — off-niche is a soft flag, never a reject", () => {
  const base = { rating: 4.5, review_count: 10, phone: "555" };

  it("keeps an off-niche lead (passes=true) but flags it", () => {
    const r = qualifies({ ...base, category: "Coffee shop" }, "dentist");
    expect(r.passes).toBe(true);
    expect(r.category_off_niche).toBe(true);
  });

  it("on-niche via alias passes without the flag", () => {
    const r = qualifies({ ...base, category: "Dental clinic" }, "dentist");
    expect(r.passes).toBe(true);
    expect(r.category_off_niche).toBe(false);
  });
});
