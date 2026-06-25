import { describe, it, expect } from "vitest";
import { deriveSegment, resolveSegment } from "@/lib/segment";

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

describe("resolveSegment (canonical, used by UI + scheduler)", () => {
  it("honors a valid operator override regardless of signals", () => {
    expect(resolveSegment({ call_segment: "has_website", website_kind: "none" })).toBe("has_website");
    expect(resolveSegment({ call_segment: "no_website", website_kind: "real" })).toBe("no_website");
  });
  it("ignores an invalid call_segment and derives", () => {
    expect(resolveSegment({ call_segment: "garbage", website_kind: "real" })).toBe("has_website");
  });
  it("no real site → no_website", () => {
    expect(resolveSegment({ call_segment: null, website_kind: "facebook" })).toBe("no_website");
    expect(resolveSegment({ website_kind: "none" })).toBe("no_website");
  });
  it("healthy real site with UNSET segment → has_website (matches the UI)", () => {
    expect(resolveSegment({ call_segment: null, website_kind: "real" })).toBe("has_website");
  });
  it("real site flagged needs_improvement → old_website", () => {
    expect(resolveSegment({ website_kind: "real", needs_improvement: true })).toBe("old_website");
  });
  it("explicit has_website wins over website_kind", () => {
    expect(resolveSegment({ has_website: true, website_kind: "none" })).toBe("has_website");
  });
});
