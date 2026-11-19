/**
 * lead-signal.test.ts — the one-line summary and labels of signal leads (here: review-site leads).
 *
 * Inputs:  signal fields of a lead
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { SIGNAL_FILTER_OPTIONS, signalSummary, signalTypeLabel } from "./lead-signal";

describe("review-site leads", () => {
  it("say where they were found, with rating and review count", () => {
    expect(
      signalSummary({ signal_type: "review_site", signal_date: null, signal_meta: { platform: "tripadvisor", rating: 2.4, review_count: 38 } }),
    ).toBe("Found on TripAdvisor · 2.4★ · 38 reviews");
    expect(signalSummary({ signal_type: "review_site", signal_date: null, signal_meta: { platform: "trustpilot" } })).toBe("Found on Trustpilot");
  });
  it("have a label and a filter option", () => {
    expect(signalTypeLabel("review_site")).toBe("Low rating (review site)");
    expect(SIGNAL_FILTER_OPTIONS.some((o) => o.value === "review_site")).toBe(true);
  });
});
