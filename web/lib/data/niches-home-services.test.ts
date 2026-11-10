/**
 * niches-home-services.test.ts — Steve's 20 emergency call-out niches sit under "Home Services" and build sensibly.
 *
 * Inputs:  NICHE_OPTIONS / NICHE_CATEGORIES / templateForNiche
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { NICHE_CATEGORIES, NICHE_OPTIONS, templateForNiche } from "./niches";

const home = NICHE_OPTIONS.filter((n) => n.category === "Home Services");

describe("Home Services niches", () => {
  it("has all 20, listed in the category picker, with no duplicate values", () => {
    expect(home).toHaveLength(20);
    expect(NICHE_CATEGORIES).toContain("Home Services");
    const all = NICHE_OPTIONS.map((n) => n.value);
    expect(new Set(all).size).toBe(all.length);
  });

  it("routes each to the best design", () => {
    expect(templateForNiche("emergency plumbing")).toBe("trades-site");
    expect(templateForNiche("ac / hvac repair")).toBe("trades-site");
    expect(templateForNiche("boiler / water heater repair")).toBe("trades-site");
    expect(templateForNiche("car towing / roadside assistance")).toBe("auto-site");
    expect(templateForNiche("mobile tire replacement")).toBe("auto-site");
    expect(templateForNiche("emergency locksmith")).toBe("premium-trades");
  });
});
