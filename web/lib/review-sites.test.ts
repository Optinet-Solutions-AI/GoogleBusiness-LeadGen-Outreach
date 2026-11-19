/**
 * review-sites.test.ts — shared rules for the review-site sources (Trustpilot, TripAdvisor).
 *
 * Inputs:  plain values
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { robotAsk } from "./review-sites";

describe("robotAsk", () => {
  it("asks the robot for 3x the leads wanted (some fall outside the rating range), capped at 300", () => {
    expect(robotAsk(5)).toBe(15);
    expect(robotAsk(100)).toBe(300);
    expect(robotAsk(500)).toBe(300);
    expect(robotAsk(0)).toBe(3);
  });
});
