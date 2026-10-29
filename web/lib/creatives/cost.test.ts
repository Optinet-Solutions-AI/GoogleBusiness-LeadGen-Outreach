/**
 * cost.test.ts — unit tests for creative cost estimation, budget cap and spend roll-up.
 *
 * Inputs:  numeric counts and prices, generation_jobs-like cost rows
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { creativeUnitUsd, estimatePlanUsd, budgetCapUsd, runCapUsd, sumSpend } from "./cost";

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

describe("runCapUsd (Ruling 32)", () => {
  it("uses the confirmed figure, not the month upper bound", () => {
    // Semper Fi 2026-12: confirmed $0.25 -> stop at $0.3125 (was $0.84 from estimate_usd 0.672)
    expect(runCapUsd({ confirmedUsd: 0.25, planBudgetUsd: 5, spentBeforeUsd: 0 })).toBeCloseTo(0.3125);
  });
  it("subtracts what earlier runs already spent on the plan from the plan budget", () => {
    expect(runCapUsd({ confirmedUsd: 2, planBudgetUsd: 5, spentBeforeUsd: 4 })).toBeCloseTo(1);
    expect(runCapUsd({ confirmedUsd: 2, planBudgetUsd: 5, spentBeforeUsd: 1 })).toBeCloseTo(2.5);
  });
  it("never goes below zero", () => {
    expect(runCapUsd({ confirmedUsd: 1, planBudgetUsd: 5, spentBeforeUsd: 6 })).toBe(0);
    expect(runCapUsd({ confirmedUsd: -1, planBudgetUsd: 5, spentBeforeUsd: 0 })).toBe(0);
  });
});

describe("sumSpend", () => {
  it("totals the plan and splits by creative; numeric strings and nulls are handled", () => {
    const s = sumSpend([
      { cost_usd: 0.003 }, // concepts call (plan only)
      { cost_usd: "0.0031", creative_id: "a" },
      { cost_usd: 0.053, creative_id: "a" },
      { cost_usd: 0, creative_id: "b" }, // render: free
      { cost_usd: null, creative_id: "c" },
    ]);
    expect(s.total_usd).toBeCloseTo(0.0591);
    expect(s.by_creative).toEqual({ a: 0.0561 });
  });
});
