/**
 * cost.test.ts — unit test for the Gemini cost estimate.
 *
 * Inputs:  a Usage literal
 * Outputs: vitest assertion
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "./cost";

describe("estimateCostUsd", () => {
  it("prices 1M in + 100k out at 0.55", () => {
    expect(estimateCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 100_000, model: "x" })).toBe(0.55);
  });
});
