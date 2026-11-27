/**
 * pricing.test.ts — WARN scraper pricing + batch settings schema.
 *
 * Inputs:  estimate / compare / BatchSettingsSchema
 * Outputs: vitest assertions
 * Used by: npm test
 */

import { describe, expect, it } from "vitest";
import { compare, estimate, WARN_MAX_PER_QUERY, WEBSITE_AI_USD_PER_LEAD } from "./pricing";
import { BatchSettingsSchema } from "./batch-settings";

describe("estimate warn", () => {
  it("is free without AI Lookup and capped at 500", () => {
    const e = estimate("warn", 600, { aiCap: 0 });
    expect(WARN_MAX_PER_QUERY).toBe(500);
    expect(e.total_usd).toBe(0);
    expect(e.scrape.subtotal_usd).toBe(0);
    expect(e.build.subtotal_usd).toBe(0);
    expect(e.effective_limit).toBe(500);
    expect(e.requested_limit).toBe(600);
    expect(e.warnings.length).toBe(1);
  });
  it("compare includes warn at $0 without AI Lookup", () => {
    expect(compare(100, { aiCap: 0 }).warn.total_usd).toBe(0);
  });
  it("AI Lookup on closing businesses (23 Nov 2026): 2 cents a notice, up to the per-batch cap", () => {
    expect(estimate("warn", 50).total_usd).toBeCloseTo(1, 4);
    expect(estimate("sec", 300, { aiCap: 100 }).scrape.lines.at(-1)).toMatchObject({ qty: 100, unit_usd: 0.02 });
    expect(estimate("warn", 50).build.subtotal_usd).toBe(0);
  });
  it("leaves google_places / apify estimates unchanged (apart from the AI research line)", () => {
    // 100 leads: $0.21 Apify + AI research on the 25 expected to qualify at 2¢ = $0.50 + the website check at 1¢ = $0.25.
    expect(estimate("apify", 100).scrape.subtotal_usd).toBeCloseTo(0.96, 4);
    expect(estimate("apify", 100, { aiCap: 0, siteCap: 0 }).scrape.subtotal_usd).toBeCloseTo(0.21, 4);
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

import { robotCapUsd } from "./pricing";

describe("robotCapUsd", () => {
  it("caps a review-site robot run at 1.5x its estimated robot cost, never below 5 cents", () => {
    expect(robotCapUsd("trustpilot", 5)).toBe(0.05);
    expect(robotCapUsd("tripadvisor", 100)).toBeCloseTo((300 * 0.00199 + 0.005) * 1.5, 4);
    expect(robotCapUsd("trustpilot", 1000)).toBe(0.081);
  });
});

import { SCRAPERS } from "./pricing";

describe("SCRAPERS (the one list both the batch and the cost-preview APIs accept)", () => {
  it("includes every source and each one has a price", () => {
    expect(SCRAPERS).toEqual(["apify", "google_places", "outscraper", "warn", "sec", "exhibitors", "trustpilot", "tripadvisor"]);
    for (const s of SCRAPERS) expect(() => estimate(s, 10), s).not.toThrow();
  });
});

describe("the OpenAI website check is in the estimate (25 Nov 2026)", () => {
  it("Google Maps batches get one line, about a cent per qualified lead, up to the per-batch limit", () => {
    const e = estimate("apify", 100);
    const line = e.scrape.lines.find((l) => /website check/i.test(l.item));
    expect(line).toBeDefined();
    expect(line!.unit_usd).toBe(WEBSITE_AI_USD_PER_LEAD);
    expect(line!.qty).toBeGreaterThan(0);
    expect(line!.qty).toBeLessThanOrEqual(100);
  });
  it("switched off (limit 0) → no line", () => {
    expect(estimate("apify", 100, { siteCap: 0 }).scrape.lines.some((l) => /website check/i.test(l.item))).toBe(false);
  });
  it("closing-business batches never get it", () => {
    expect(estimate("warn", 100).scrape.lines.some((l) => /website check/i.test(l.item))).toBe(false);
  });
});

describe("lead score line (27 Nov 2026)", () => {
  it("adds the lead score line when scoreCap is given, capped like AI Lookup", () => {
    const e = estimate("apify", 100, { aiCap: 100, siteCap: 0, scoreCap: 100 });
    const line = e.scrape.lines.find((l) => /Lead score/.test(l.item))!;
    const lookups = e.scrape.lines.find((l) => /AI Lookup/.test(l.item))!;
    expect(line.qty).toBe(lookups.qty);
    expect(line.cost_usd).toBeCloseTo(line.qty * 0.005, 4);
    expect(e.scrape.subtotal_usd).toBeCloseTo(estimate("apify", 100, { aiCap: 100, siteCap: 0 }).scrape.subtotal_usd + line.cost_usd, 4);
  });
  it("no lead score line without scoreCap (old callers unchanged)", () => {
    expect(estimate("apify", 100).scrape.lines.some((l) => /Lead score/.test(l.item))).toBe(false);
  });
  it("scoreCap below the lookups caps the scored leads", () => {
    expect(estimate("apify", 100, { aiCap: 100, scoreCap: 5 }).scrape.lines.find((l) => /Lead score/.test(l.item))!.qty).toBe(5);
  });
  it("every lead source with AI Lookup gets it; none when AI Lookup is off", () => {
    for (const s of ["warn", "sec", "exhibitors", "trustpilot", "tripadvisor", "outscraper", "google_places"] as const) {
      expect(estimate(s, 50, { scoreCap: 100 }).scrape.lines.some((l) => /Lead score/.test(l.item))).toBe(true);
    }
    expect(estimate("apify", 100, { aiCap: 0, scoreCap: 100 }).scrape.lines.some((l) => /Lead score/.test(l.item))).toBe(false);
  });
});
