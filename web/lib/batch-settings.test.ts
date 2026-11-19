/**
 * batch-settings.test.ts — defaults and bounds of the per-batch source settings.
 *
 * Inputs:  raw settings objects
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { BatchSettingsSchema } from "./batch-settings";

describe("review-site settings", () => {
  it("default to 1–3.5 stars and at least 5 reviews", () => {
    expect(BatchSettingsSchema.parse({})).toMatchObject({ min_rating: 1, max_rating: 3.5, min_reviews: 5 });
  });
  it("reject a range that ends below its start, or ratings outside 1–5", () => {
    expect(() => BatchSettingsSchema.parse({ min_rating: 4, max_rating: 3 })).toThrow();
    expect(() => BatchSettingsSchema.parse({ max_rating: 6 })).toThrow();
    expect(() => BatchSettingsSchema.parse({ min_reviews: -1 })).toThrow();
  });
  it("accept a custom range", () => {
    expect(BatchSettingsSchema.parse({ min_rating: 2, max_rating: 4, min_reviews: 20 })).toMatchObject({ min_rating: 2, max_rating: 4, min_reviews: 20 });
  });
});
