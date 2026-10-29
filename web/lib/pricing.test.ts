/**
 * pricing.test.ts — WARN scraper pricing + batch settings schema.
 *
 * Inputs:  estimate / compare / BatchSettingsSchema
 * Outputs: vitest assertions
 * Used by: npm test
 */

import { describe, expect, it } from "vitest";
import { compare, estimate, WARN_MAX_PER_QUERY } from "./pricing";
import { BatchSettingsSchema } from "./batch-settings";

describe("estimate warn", () => {
  it("is free and capped at 500", () => {
    const e = estimate("warn", 600);
    expect(WARN_MAX_PER_QUERY).toBe(500);
    expect(e.total_usd).toBe(0);
    expect(e.scrape.subtotal_usd).toBe(0);
    expect(e.build.subtotal_usd).toBe(0);
    expect(e.effective_limit).toBe(500);
    expect(e.requested_limit).toBe(600);
    expect(e.warnings.length).toBe(1);
  });
  it("compare includes warn at $0", () => {
    expect(compare(100).warn.total_usd).toBe(0);
  });
  it("leaves google_places / apify estimates unchanged", () => {
    expect(estimate("apify", 100).scrape.subtotal_usd).toBeCloseTo(0.21, 4);
    expect(estimate("google_places", 60).effective_limit).toBe(60);
    expect(estimate("apify", 100).build.lines.length).toBe(2);
  });
});

describe("BatchSettingsSchema", () => {
  it("applies defaults", () => {
    expect(BatchSettingsSchema.parse({})).toEqual({ window_days: 90, min_employees: 10 });
  });
  it("rejects window_days 0", () => {
    expect(() => BatchSettingsSchema.parse({ window_days: 0 })).toThrow();
  });
});
