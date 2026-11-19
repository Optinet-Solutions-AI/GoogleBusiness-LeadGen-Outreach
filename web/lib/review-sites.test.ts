/**
 * review-sites.test.ts — shared rules for the review-site sources (Trustpilot, TripAdvisor).
 *
 * Inputs:  plain values
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { cityForTripAdvisor, inRatingRange, PLATFORM_LABEL, reviewPlaceId, robotAsk } from "./review-sites";

const RANGE = { min_rating: 1, max_rating: 3.5, min_reviews: 5 };

describe("robotAsk", () => {
  it("asks the robot for 3x the leads wanted (some fall outside the rating range), capped at 300", () => {
    expect(robotAsk(5)).toBe(15);
    expect(robotAsk(100)).toBe(300);
    expect(robotAsk(500)).toBe(300);
    expect(robotAsk(0)).toBe(3);
  });
});

describe("reviewPlaceId", () => {
  it("is the platform plus the profile path, so the same profile is the same lead", () => {
    expect(reviewPlaceId("trustpilot", "https://www.trustpilot.com/review/jdbyrider.com")).toBe("trustpilot:/review/jdbyrider.com");
    expect(reviewPlaceId("tripadvisor", "https://www.tripadvisor.com/Restaurant_Review-g30196-d1-Reviews-X.html?m=1")).toBe(
      "tripadvisor:/Restaurant_Review-g30196-d1-Reviews-X.html",
    );
  });
});

describe("inRatingRange", () => {
  it("keeps the boundaries and drops unknown ratings or too few reviews", () => {
    expect(inRatingRange(3.5, 10, RANGE)).toBe(true);
    expect(inRatingRange(1, 5, RANGE)).toBe(true);
    expect(inRatingRange(3.6, 10, RANGE)).toBe(false);
    expect(inRatingRange(null, 10, RANGE)).toBe(false);
    expect(inRatingRange(2, 4, RANGE)).toBe(false);
    expect(inRatingRange(2, null, RANGE)).toBe(false);
  });
});

describe("cityForTripAdvisor", () => {
  it("sends only the city name (Austin, TX mis-resolves on TripAdvisor)", () => {
    expect(cityForTripAdvisor("Austin, TX")).toBe("Austin");
    expect(cityForTripAdvisor("  Valletta ")).toBe("Valletta");
  });
});

describe("PLATFORM_LABEL", () => {
  it("names each site for the operator", () => {
    expect(PLATFORM_LABEL).toEqual({ trustpilot: "Trustpilot", tripadvisor: "TripAdvisor" });
  });
});
