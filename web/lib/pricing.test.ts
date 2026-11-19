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
  it("leaves google_places / apify estimates unchanged (apart from the AI research line)", () => {
    // 100 leads: $0.21 Apify + AI research on the 25 expected to qualify at 2¢ = $0.50.
    expect(estimate("apify", 100).scrape.subtotal_usd).toBeCloseTo(0.71, 4);
    expect(estimate("apify", 100, { aiCap: 0 }).scrape.subtotal_usd).toBeCloseTo(0.21, 4);
    expect(estimate("apify", 1000, { aiCap: 100 }).scrape.lines.at(-1)).toMatchObject({ qty: 75 });
    expect(estimate("google_places", 60).effective_limit).toBe(60);
    expect(estimate("apify", 100).build.lines.length).toBe(2);
  });
});

describe("BatchSettingsSchema", () => {
  it("applies defaults", () => {
    expect(BatchSettingsSchema.parse({})).toMatchObject({ window_days: 90, min_employees: 10 });
  });
  it("rejects window_days 0", () => {
    expect(() => BatchSettingsSchema.parse({ window_days: 0 })).toThrow();
  });
});

describe("estimate review sites", () => {
  it("prices the Trustpilot robot for 3x the limit, plus AI contact research, and never a build", () => {
    const e = estimate("trustpilot", 100);
    const robot = e.scrape.lines.find((l) => /Trustpilot/.test(l.item))!;
    expect(robot).toMatchObject({ qty: 300, unit_usd: 0.00018 });
    expect(e.build.subtotal_usd).toBe(0);
  });
  it("prices the TripAdvisor robot per place plus its run start", () => {
    const e = estimate("tripadvisor", 10);
    expect(e.scrape.lines.find((l) => /TripAdvisor places/.test(l.item))).toMatchObject({ qty: 30, unit_usd: 0.00199 });
    expect(e.scrape.lines.find((l) => /TripAdvisor run/.test(l.item))).toMatchObject({ qty: 1, unit_usd: 0.005 });
    expect(e.build.subtotal_usd).toBe(0);
  });
});
