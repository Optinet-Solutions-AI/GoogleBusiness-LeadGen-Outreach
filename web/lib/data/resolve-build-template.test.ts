/**
 * resolve-build-template.test.ts — locks legacy-batch build resolution.
 * Regression: Same Day Air Repair (HVAC) couldn't build because its batch
 * stored the legacy slug "trades" (not the focus "trades-site").
 */
import { describe, it, expect } from "vitest";
import { resolveBuildTemplate } from "./niches";

describe("resolveBuildTemplate", () => {
  it("passes a focus slug through unchanged", () => {
    expect(resolveBuildTemplate({ batchTemplateSlug: "auto-site" })).toBe("auto-site");
  });

  it("maps a legacy 'trades' batch via the lead category (HVAC)", () => {
    expect(
      resolveBuildTemplate({ batchTemplateSlug: "trades", category: "HVAC contractor" }),
    ).toBe("trades-site");
  });

  it("maps a generic 'premium-trades' batch via the lead category (dentist)", () => {
    expect(
      resolveBuildTemplate({ batchTemplateSlug: "premium-trades", category: "Dental clinic" }),
    ).toBe("dental-site");
  });

  it("falls back to the batch niche when category is unhelpful", () => {
    expect(
      resolveBuildTemplate({ batchTemplateSlug: "trades", category: "Establishment", niche: "auto repair shop" }),
    ).toBe("auto-site");
  });

  it("returns null for a genuinely non-focus business (lawyer)", () => {
    expect(
      resolveBuildTemplate({ batchTemplateSlug: "premium-trades", category: "Law firm", niche: "lawyer" }),
    ).toBeNull();
  });

  it("returns null when nothing is buildable and no hints", () => {
    expect(resolveBuildTemplate({ batchTemplateSlug: "premium-trades" })).toBeNull();
  });
});
