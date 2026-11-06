/**
 * resolve-build-template.test.ts — locks legacy-batch build resolution.
 * Regression: Same Day Air Repair (HVAC) couldn't build because its batch
 * stored the legacy slug "trades" (not the focus "trades-site").
 */
import { describe, it, expect } from "vitest";
import { hasDedicatedTemplate, resolveBuildTemplate } from "./niches";

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

  it("falls back to the general template for a niche without a dedicated one (lawyer)", () => {
    expect(
      resolveBuildTemplate({ batchTemplateSlug: "premium-trades", category: "Law firm", niche: "lawyer" }),
    ).toBe("premium-trades");
    expect(hasDedicatedTemplate({ batchTemplateSlug: "premium-trades", category: "Law firm", niche: "lawyer" })).toBe(false);
  });

  it("falls back to the general template with no hints at all (imported lead)", () => {
    expect(resolveBuildTemplate({ batchTemplateSlug: "trades" })).toBe("premium-trades");
    expect(resolveBuildTemplate({})).toBe("premium-trades");
    expect(hasDedicatedTemplate({ category: "HVAC contractor" })).toBe(true);
  });
});
