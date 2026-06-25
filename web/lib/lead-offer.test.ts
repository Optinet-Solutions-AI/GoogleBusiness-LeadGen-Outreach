/**
 * lead-offer.test.ts — locks the build/offer surface decision.
 * has_website must never show the Build surface (pitch AI services instead).
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
  it("has_website (focus niche) → ai_services, never build", () => {
    expect(buildSurfaceFor({ segment: "has_website", buildable: true })).toBe("ai_services");
  });
  it("has_website (non-focus niche) → ai_services", () => {
    expect(buildSurfaceFor({ segment: "has_website", buildable: false })).toBe("ai_services");
  });
  it("no_website but non-focus niche → off_niche", () => {
    expect(buildSurfaceFor({ segment: "no_website", buildable: false })).toBe("off_niche");
  });
});
