/**
 * refound.test.ts — a review-site profile already on a lead from an earlier batch only refreshes that lead.
 *
 * Inputs:  stage-1 rows + a place_id → lead id map of leads in other batches
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { splitRefound } from "./refound";

const row = (place_id: string, extra: Record<string, unknown> = {}) => ({
  place_id,
  business_name: "Acme",
  stage: "scraped",
  email: "a@acme.com",
  rating: 2.1,
  review_count: 40,
  signal_meta: { platform: "trustpilot", rating: 2.1, review_count: 40 },
  ...extra,
});

describe("splitRefound", () => {
  it("refreshes only rating, review count and signal details of a lead found before", () => {
    const { insert, refresh } = splitRefound([row("trustpilot:/review/acme.com"), row("trustpilot:/review/new.com")], new Map([["trustpilot:/review/acme.com", "lead-1"]]));
    expect(insert.map((r) => r.place_id)).toEqual(["trustpilot:/review/new.com"]);
    expect(refresh).toEqual([
      { id: "lead-1", patch: { rating: 2.1, review_count: 40, signal_meta: { platform: "trustpilot", rating: 2.1, review_count: 40 } } },
    ]);
  });
  it("inserts everything when nothing was found before", () => {
    const rows = [row("tripadvisor:/a"), row("tripadvisor:/b")];
    expect(splitRefound(rows, new Map())).toEqual({ insert: rows, refresh: [] });
  });
});
