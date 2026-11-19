/**
 * trustpilot.test.ts — Trustpilot robot rows become review-site leads (fixture = the 19 Nov 2026 test run).
 *
 * Inputs:  __fixtures__/trustpilot-sample.json + a fake robot runner
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import sample from "./__fixtures__/trustpilot-sample.json";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("../config", () => ({ env: { APIFY_TOKEN: "tok" } }));
vi.mock("../logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
const runActor = vi.fn();
vi.mock("./apify-run", () => ({ runActor: (...a: unknown[]) => runActor(...a), ApifyRunError: class extends Error {} }));

import { mapTrustpilotItem, searchTrustpilot } from "./trustpilot";

const SETTINGS = { min_rating: 1, max_rating: 3.5, min_reviews: 5 };

describe("mapTrustpilotItem", () => {
  it("maps a business with its rating, contacts and profile", () => {
    const jd = mapTrustpilotItem(sample[1])!;
    expect(jd).toMatchObject({
      business_name: "J.D. Byrider",
      email: "customerservice@jdbyrider.com",
      phone: "317-249-3000",
      website: "https://www.jdbyrider.com/",
      has_website: true,
      rating: 2.4,
      review_count: 3485,
      category: "Car Dealer",
      country_code: "US",
      place_id: "trustpilot:/review/jdbyrider.com",
    });
    expect(jd.signal).toMatchObject({ type: "review_site", source_url: "https://www.trustpilot.com/review/jdbyrider.com" });
    expect(jd.signal!.meta).toMatchObject({ platform: "trustpilot", rating: 2.4, review_count: 3485 });
  });
  it("skips rows without a name or profile (error rows)", () => {
    expect(mapTrustpilotItem({ type: "error", error: "blocked" })).toBeNull();
  });
});

describe("searchTrustpilot", () => {
  it("asks the robot to filter the rating and returns kept leads up to the limit", async () => {
    runActor.mockResolvedValueOnce({ items: sample, status: "SUCCEEDED", usageUsd: 0.001 });
    const r = await searchTrustpilot({ category: "car_dealer", country: "us", settings: SETTINGS, limit: 3, maxChargeUsd: 0.1 });
    const call = runActor.mock.calls[0][0];
    expect(call.actor).toBe("scrapersdelight~trustpilot-business-leads-scraper");
    expect(call.input).toMatchObject({
      categories: ["car_dealer"],
      countries: ["US"],
      minTrustScore: 1,
      maxTrustScore: 3.5,
      minReviews: 5,
      maxResults: 9,
      onlyWithContact: true,
      recentReviews: 0,
    });
    expect(r.leads).toHaveLength(3);
    expect(r).toMatchObject({ found: 5, usageUsd: 0.001 });
  });
  it("fails in the robot's own words when every row is an error", async () => {
    runActor.mockResolvedValueOnce({ items: [{ type: "error", error: "Trustpilot blocked the request (HTTP 403)" }], status: "SUCCEEDED", usageUsd: 0 });
    await expect(
      searchTrustpilot({ category: "car_dealer", country: "us", settings: SETTINGS, limit: 3, maxChargeUsd: 0.1 }),
    ).rejects.toThrow(/blocked/);
  });
  it("passes on that the robot was stopped early, so the batch can say so", async () => {
    runActor.mockResolvedValueOnce({ items: sample, status: "ABORTED", usageUsd: 0.05, cutShort: true });
    const r = await searchTrustpilot({ category: "car_dealer", country: "us", settings: SETTINGS, limit: 3, maxChargeUsd: 0.1 });
    expect(r.cutShort).toBe(true);
  });
});
