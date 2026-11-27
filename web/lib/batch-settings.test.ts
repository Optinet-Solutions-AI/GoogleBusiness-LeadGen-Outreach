/**
 * batch-settings.test.ts — defaults and bounds of the per-batch source settings.
 *
 * Inputs:  raw settings objects
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { BatchSettingsSchema, batchJobTimeoutS, stopsNewRowsAtBudget } from "./batch-settings";

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

describe("an imported list's run time (review I4)", () => {
  it("every run of an import batch gets 4 hours (first run, Resume, Re-run); others keep the default", () => {
    expect(batchJobTimeoutS("import")).toBe(4 * 3600);
    expect(batchJobTimeoutS("apify")).toBeUndefined();
  });
  it("an import batch stops starting new rows at its time budget, so it ends done with what it checked", () => {
    expect(stopsNewRowsAtBudget("import")).toBe(true);
    expect(stopsNewRowsAtBudget("apify")).toBe(false);
  });
});
