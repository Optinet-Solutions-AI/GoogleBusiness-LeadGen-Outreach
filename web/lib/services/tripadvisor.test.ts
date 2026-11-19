/**
 * tripadvisor.test.ts — TripAdvisor robot rows become review-site leads (fixture = the 19 Nov 2026 test run).
 *
 * Inputs:  __fixtures__/tripadvisor-sample.json + a fake robot runner
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import sample from "./__fixtures__/tripadvisor-sample.json";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("../config", () => ({ env: { APIFY_TOKEN: "tok" } }));
vi.mock("../logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
const runActor = vi.fn();
vi.mock("./apify-run", () => ({ runActor: (...a: unknown[]) => runActor(...a), ApifyRunError: class extends Error {} }));

import { mapTripAdvisorItem, searchTripAdvisor } from "./tripadvisor";

describe("mapTripAdvisorItem", () => {
  it("maps a place with its rating, contacts and profile", () => {
    const p = mapTripAdvisorItem(sample[1])!;
    expect(p).toMatchObject({
      business_name: "P. Terry's Burger Stand",
      email: "feedback@pterrys.com",
      phone: "+1 737-334-3059",
      website: "https://pterrys.com/",
      rating: 3,
      review_count: 1,
      category: "restaurant",
      address: "515 Congress Ave., Austin, Texas, 78701, United States",
      place_id: "tripadvisor:/Restaurant_Review-g30196-d23732781-Reviews-P_Terry_s_Burger_Stand-Austin_Texas.html",
    });
    expect(p.signal).toMatchObject({ type: "review_site", meta: { platform: "tripadvisor", rating: 3, review_count: 1 } });
  });
});

describe("searchTripAdvisor", () => {
  it("sends the city name only, then keeps places in the rating range with enough reviews", async () => {
    runActor.mockResolvedValueOnce({ items: sample, status: "SUCCEEDED", usageUsd: 0.015 });
    const r = await searchTripAdvisor({
      city: "Austin, TX",
      category: "restaurants",
      settings: { min_rating: 1, max_rating: 4, min_reviews: 1 },
      limit: 10,
      maxChargeUsd: 0.1,
    });
    expect(runActor.mock.calls[0][0]).toMatchObject({
      actor: "clearpath~tripadvisor-scraper",
      input: { locations: ["Austin"], categories: ["restaurants"], maxPlacesPerCategory: 30, includeDetails: true },
    });
    // Kept: Jimmy John's 4 stars (78 reviews), P. Terry's 3 stars (1). Dropped: no rating, or 4.3 stars.
    expect(r.leads.map((l) => l.business_name)).toEqual(["Jimmy John's", "P. Terry's Burger Stand"]);
    expect(r.found).toBe(5);
  });
  it("drops a place under the minimum reviews", async () => {
    runActor.mockResolvedValueOnce({ items: sample, status: "SUCCEEDED", usageUsd: 0.015 });
    const r = await searchTripAdvisor({
      city: "Austin",
      category: "restaurants",
      settings: { min_rating: 1, max_rating: 4, min_reviews: 5 },
      limit: 10,
      maxChargeUsd: 0.1,
    });
    expect(r.leads.map((l) => l.business_name)).toEqual(["Jimmy John's"]);
  });
  it("fails in the robot's own words when every row is an error", async () => {
    runActor.mockResolvedValueOnce({ items: [{ type: "error", error: "TripAdvisor blocked the request" }], status: "SUCCEEDED", usageUsd: 0 });
    await expect(
      searchTripAdvisor({ city: "Austin", category: "restaurants", settings: { min_rating: 1, max_rating: 3.5, min_reviews: 5 }, limit: 5, maxChargeUsd: 0.1 }),
    ).rejects.toThrow(/blocked/);
  });
});
