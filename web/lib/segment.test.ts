import { describe, it, expect } from "vitest";
import { deriveSegment, resolveSegment, siteUnchecked } from "@/lib/segment";

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

describe("deriveSegment liquidation", () => {
  it("a closure signal -> liquidation regardless of website", () => {
    expect(deriveSegment({ has_website: false, needs_improvement: false, signal_type: "closure" })).toBe("liquidation");
    expect(deriveSegment({ has_website: true, signal_type: "layoff" })).toBe("liquidation");
  });
  it("null/absent signal_type is unchanged", () => {
    expect(deriveSegment({ has_website: false, signal_type: null })).toBe("no_website");
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
  it("a signal lead with no override resolves to liquidation", () => {
    expect(resolveSegment({ has_website: true, signal_type: "closure" })).toBe("liquidation");
  });
});

describe("review-site leads (19 Nov 2026)", () => {
  it("are the reputation segment, never liquidation", () => {
    expect(deriveSegment({ has_website: true, signal_type: "review_site" })).toBe("reputation");
    expect(deriveSegment({ has_website: false, signal_type: "review_site" })).toBe("reputation");
  });
});

describe("siteUnchecked (QA 23 Nov 2026: an unchecked site showed as 'Good website')", () => {
  const base = { has_website: true, website_kind: "real", website_status: null, offer_locked: false, signal_type: null };
  it("a real website we never checked, with no choice made by a person", () => expect(siteUnchecked(base)).toBe(true));
  it("not once the site was checked, or a person picked the pitch", () => {
    expect(siteUnchecked({ ...base, website_status: "200" })).toBe(false);
    expect(siteUnchecked({ ...base, offer_locked: true })).toBe(false);
  });
  it("not for a lead with no real website, or a closing / conference / review-site lead", () => {
    expect(siteUnchecked({ ...base, has_website: false, website_kind: "facebook" })).toBe(false);
    expect(siteUnchecked({ ...base, signal_type: "closure" })).toBe(false);
  });
});
