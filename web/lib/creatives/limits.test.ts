/**
 * limits.test.ts — unit tests for per-platform caption limits.
 *
 * Inputs:  hand-built CreativeCopy values
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { PLATFORM_LIMITS, checkCaptionLimits } from "./limits";

const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

describe("checkCaptionLimits", () => {
  it("has the documented limits", () => {
    expect(PLATFORM_LIMITS.instagram).toEqual({ maxChars: 2200, maxHashtags: 20 });
    expect(PLATFORM_LIMITS.facebook).toEqual({ maxChars: 2000, maxHashtags: 5 });
    expect(PLATFORM_LIMITS.linkedin).toEqual({ maxChars: 3000, maxHashtags: 3 });
  });
  it("accepts copy within limits", () => {
    expect(checkCaptionLimits({ instagram: { caption: "hi", hashtags: tags(20) } })).toEqual([]);
  });
  it("flags 21 Instagram hashtags", () => {
    const r = checkCaptionLimits({ instagram: { caption: "hi", hashtags: tags(21) } });
    expect(r).toHaveLength(1);
    expect(r[0].platform).toBe("instagram");
  });
  it("flags a 2,201-char caption", () => {
    const r = checkCaptionLimits({ instagram: { caption: "x".repeat(2201), hashtags: [] } });
    expect(r).toHaveLength(1);
    expect(r[0].platform).toBe("instagram");
  });
  it("flags each platform independently", () => {
    const r = checkCaptionLimits({
      facebook: { caption: "ok", hashtags: tags(6) },
      linkedin: { caption: "ok", hashtags: tags(4) },
    });
    expect(r.map((x) => x.platform).sort()).toEqual(["facebook", "linkedin"]);
  });
});
