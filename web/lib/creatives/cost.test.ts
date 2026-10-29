/**
 * cost.test.ts — unit tests for creative cost estimation and budget cap.
 *
 * Inputs:  numeric counts and prices
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { creativeUnitUsd, estimatePlanUsd, budgetCapUsd } from "./cost";

describe("cost", () => {
  it("unit cost adds the image price only with a background", () => {
    expect(creativeUnitUsd({ background: false }, 0.053)).toBeCloseTo(0.003);
    expect(creativeUnitUsd({ background: true }, 0.053)).toBeCloseTo(0.056);
  });
  it("estimates a plan", () => {
    expect(estimatePlanUsd(12, 8, 0.053)).toBeCloseTo(12 * 0.003 + 8 * 0.053);
  });
  it("caps the budget at 125% of the confirmed estimate or the plan budget", () => {
    expect(budgetCapUsd(2, 5)).toBe(2.5);
    expect(budgetCapUsd(10, 5)).toBe(5);
  });
});
