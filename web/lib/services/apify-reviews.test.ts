/**
 * apify-reviews.test.ts — place-id check, reviewer-name shortening, review selection and cost.
 *
 * Inputs:  hand-written actor rows (fields: text, stars, name)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/config", () => ({ env: {} }));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { isGooglePlaceId, reviewsCostUsd, shortAuthor, toPlaceReviews } from "./apify-reviews";

describe("apify-reviews", () => {
  it("accepts Google place ids and refuses synthetic signal ids", () => {
    expect(isGooglePlaceId("ChIJreV9aqYWdkgROM_boL6YbwA")).toBe(true);
    expect(isGooglePlaceId("warn:12345")).toBe(false);
    expect(isGooglePlaceId("sec:0001493152-26-048795")).toBe(false);
    expect(isGooglePlaceId(null)).toBe(false);
  });

  it("shortens a reviewer to first name + last initial", () => {
    expect(shortAuthor("Maria Lopez Garcia")).toBe("Maria G.");
    expect(shortAuthor("  john   smith ")).toBe("john S.");
    expect(shortAuthor("Cher")).toBe("Cher");
    expect(shortAuthor("  ")).toBeNull();
  });

  it("keeps reviews with text and a name, best-rated first, capped", () => {
    const out = toPlaceReviews(
      [
        { text: "Okay job.", stars: 3, name: "Ann Lee" },
        { text: "", stars: 5, name: "No Text" },
        { text: "Fixed our AC same day!", stars: 5, name: "Bob Ray" },
        { text: "Anonymous praise", stars: 5, name: null },
        { text: "Great crew.", stars: 5, name: "Cy Dee" },
      ],
      2,
    );
    expect(out).toEqual([
      { text: "Fixed our AC same day!", rating: 5, author: "Bob R." },
      { text: "Great crew.", rating: 5, author: "Cy D." },
    ]);
  });

  it("charges every scraped review plus the start", () => {
    expect(reviewsCostUsd(20)).toBeCloseTo(0.01205, 5);
  });
});
