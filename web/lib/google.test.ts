/**
 * google.test.ts — the "open on Google Maps" link for a lead.
 *
 * Inputs:  lead-like objects
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { googleProfileUrl } from "./google";

describe("googleProfileUrl", () => {
  it("links a Google place id to the exact listing", () => {
    expect(googleProfileUrl({ place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4" })).toBe(
      "https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4",
    );
  });

  it("searches by name for our own ids (conference, closure, review-site leads)", () => {
    for (const id of ["exhibitor:acme gaming", "warn:123", "trustpilot:www.acme.com"]) {
      expect(googleProfileUrl({ place_id: id, business_name: "Acme Gaming" })).toBe(
        "https://www.google.com/maps/search/?api=1&query=Acme%20Gaming",
      );
    }
  });
});
