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

describe("qualifies — closure-signal leads (source-aware)", () => {
  const now = new Date("2026-10-29T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const sig = { business_name: "Acme Co", signal_type: "closure", signal_date: daysAgo(5), signal_meta: { employees_affected: 50 } };

  it("qualifies with no phone, rating or reviews", () => {
    expect(qualifies(sig, null, { now })).toMatchObject({ passes: true, reason: null });
  });
  it("stale_signal when signal_date is 45 days old", () => {
    expect(qualifies({ ...sig, signal_date: daysAgo(45) }, null, { now })).toMatchObject({ passes: false, reason: "stale_signal" });
  });
  it("below_min_employees when 4 < minEmployees 10", () => {
    const r = qualifies({ ...sig, signal_meta: { employees_affected: 4 } }, null, { now, minEmployees: 10 });
    expect(r).toMatchObject({ passes: false, reason: "below_min_employees" });
  });
  it("unknown employee count is not rejected", () => {
    expect(qualifies({ ...sig, signal_meta: null }, null, { now, minEmployees: 10 }).passes).toBe(true);
  });
  it("Google lead without a phone is still no_phone", () => {
    expect(qualifies({ rating: 4.5, review_count: 20, phone: null }, null, { now })).toMatchObject({ passes: false, reason: "no_phone" });
  });
  it("CLOSED_PERMANENTLY Google lead is still rejected", () => {
    expect(qualifies({ rating: 4.5, review_count: 20, phone: "1", business_status: "CLOSED_PERMANENTLY" }).reason).toBe("closed_permanently");
  });
});
