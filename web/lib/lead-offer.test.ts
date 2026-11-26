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

describe("reputation leads", () => {
  it("are never built for", () => {
    expect(buildSurfaceFor({ segment: "reputation", buildable: true })).toBe("off_niche");
  });
});

import { canBuildWebsite, stageToKeepAfterBuild } from "./lead-offer";

describe("canBuildWebsite (26 Nov 2026: Build at any stage)", () => {
  it("offers Build on a normal lead with no demo, whatever its stage", () => {
    for (const stage of ["scraped", "enriched", "generated", "outreached", "needs_email", "replied", "meeting_booked", "meeting_done", "closed_lost", "dead"]) {
      expect(canBuildWebsite({ stage, demoUrl: null, surface: "build" }), stage).toBe(true);
    }
  });

  it("not when a demo already exists, and never for closing-business / exhibitor / review-site leads", () => {
    expect(canBuildWebsite({ stage: "outreached", demoUrl: "https://x.pages.dev", surface: "build" })).toBe(false);
    expect(canBuildWebsite({ stage: "scraped", demoUrl: null, surface: "off_niche" })).toBe(false);
  });
});

describe("stageToKeepAfterBuild", () => {
  it("keeps the stage of a lead that was already contacted or further along", () => {
    for (const stage of ["outreached", "replied", "meeting_booked", "meeting_done", "improved", "handed_over", "closed_won", "closed_lost", "dead"]) {
      expect(stageToKeepAfterBuild(stage), stage).toBe(stage);
    }
  });

  it("lets a new lead move to deployed as before", () => {
    for (const stage of ["scraped", "enriched", "generated", "deployed", "needs_email", "", null]) {
      expect(stageToKeepAfterBuild(stage), String(stage)).toBeNull();
    }
  });
});
