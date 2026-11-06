/**
 * lead-offer.test.ts — locks the build/offer surface decision.
 * Build is available for every normal lead; only closure / exhibitor leads never build.
 */
import { describe, it, expect } from "vitest";
import { buildSurfaceFor } from "./lead-offer";

describe("buildSurfaceFor", () => {
  it("no_website in a focus niche → build", () => {
    expect(buildSurfaceFor({ segment: "no_website", buildable: true })).toBe("build");
  });
  it("old_website in a focus niche → build", () => {
    expect(buildSurfaceFor({ segment: "old_website", buildable: true })).toBe("build");
  });
  it("has_website can still be built on demand (outreach pitches AI services, the operator may build)", () => {
    expect(buildSurfaceFor({ segment: "has_website", buildable: true })).toBe("build");
    expect(buildSurfaceFor({ segment: "has_website", buildable: false })).toBe("build");
  });
  it("no_website in a niche without a dedicated template → still build (general template)", () => {
    expect(buildSurfaceFor({ segment: "no_website", buildable: false })).toBe("build");
  });
  it("liquidation never builds, even when buildable", () => {
    expect(buildSurfaceFor({ segment: "liquidation", buildable: true })).toBe("off_niche");
  });
});
