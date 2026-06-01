import { describe, it, expect } from "vitest";
import { deriveSegment } from "@/lib/segment";

describe("deriveSegment", () => {
  it("no real website → no_website", () => {
    expect(deriveSegment({ has_website: false })).toBe("no_website");
  });
  it("real website that needs improvement → old_website", () => {
    expect(deriveSegment({ has_website: true, needs_improvement: true })).toBe("old_website");
  });
  it("real healthy website → has_website", () => {
    expect(deriveSegment({ has_website: true, needs_improvement: false })).toBe("has_website");
  });
  it("real website not yet audited (null) → has_website (don't assume it's bad)", () => {
    expect(deriveSegment({ has_website: true, needs_improvement: null })).toBe("has_website");
  });
});
