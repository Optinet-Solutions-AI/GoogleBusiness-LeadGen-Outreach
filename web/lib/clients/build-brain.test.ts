/**
 * build-brain.test.ts — unit tests for the pure parts of the brand brain build.
 *
 * Inputs:  recorded fayetteheating.com fixtures (extract/__fixtures__), hand-built leads
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect, vi } from "vitest";
import { assertBuildable, mapsFactsFromLead } from "./build-brain";
import { assembleProfile, validateFacts } from "./facts";
import pages from "./extract/__fixtures__/sample-pages.json";
import extraction from "./extract/__fixtures__/sample-extraction.json";

vi.mock("@/lib/server-guard", () => ({}));

describe("assertBuildable", () => {
  it("throws the exact message when there are no sources", () => {
    expect(() => assertBuildable([])).toThrow(
      "Attach at least one source (website, social, Google Maps or the intake form) before building.",
    );
  });
  it("accepts one source", () => {
    expect(() => assertBuildable([{ kind: "google_maps" } as never])).not.toThrow();
  });
});

describe("mapsFactsFromLead", () => {
  it("maps hours and reviews", () => {
    const m = mapsFactsFromLead({
      business_name: "Acme",
      category: "Plumber",
      address: "1 Main St",
      phone: "555",
      rating: 4.5,
      review_count: 12,
      business_hours: { mon: "8am-5pm" },
      reviews: [{ text: "Great", rating: 5, author: "Ann" }, { text: "" }, { rating: 3 }],
    });
    expect(m.hours).toEqual({ mon: "8am-5pm" });
    expect(m.reviews).toEqual([{ author: "Ann", rating: 5, text: "Great" }]);
    expect(m.name).toBe("Acme");
  });
  it("tolerates null hours/reviews", () => {
    const m = mapsFactsFromLead({
      business_name: "A", category: null, address: null, phone: null,
      rating: null, review_count: null, business_hours: null, reviews: null,
    });
    expect(m.hours).toBeNull();
    expect(m.reviews).toEqual([]);
  });
});

describe("recorded extraction fixture", () => {
  it("assembles a profile with a name and allowed claims", () => {
    const refs = pages.map((p) => ({ id: p.id, url: p.url, text: p.text }));
    const { kept } = validateFacts(extraction.output.facts as never, refs);
    const profile = assembleProfile(kept, refs);
    expect(profile.business.name).not.toBeNull();
    expect(profile.claims.allowed.length).toBeGreaterThanOrEqual(1);
  });
});
