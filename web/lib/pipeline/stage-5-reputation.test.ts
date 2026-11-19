/**
 * stage-5-reputation.test.ts — the old single-email path never sends a website pitch to a review-site lead.
 *
 * Inputs:  sample leads
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { hasStage5Email } from "./stage-5-email";

describe("hasStage5Email", () => {
  it("refuses reputation leads (they're emailed through Send email's reputation template only)", () => {
    expect(hasStage5Email({ primary_offer: "reputation_mgmt", signal_type: "review_site" })).toBe(false);
    expect(hasStage5Email({ primary_offer: null, signal_type: "review_site" })).toBe(false);
  });
  it("keeps the website, inventory and booth emails", () => {
    expect(hasStage5Email({ primary_offer: "build_website", signal_type: null })).toBe(true);
    expect(hasStage5Email({ primary_offer: "buy_inventory", signal_type: "closure" })).toBe(true);
    expect(hasStage5Email({ primary_offer: "booth_build", signal_type: "exhibitor" })).toBe(true);
  });
});
