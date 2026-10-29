/**
 * state.test.ts — unit tests for the pure creative version state rules.
 *
 * Inputs:  version fixtures
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { canApprove, nextStateForReview, editCreatesDraft, planEstimateCount } from "./state";
import type { Aspect, RenderRef } from "./types";

const render = (aspect: Aspect): RenderRef => ({
  aspect,
  slide: null,
  asset_id: `a-${aspect}`,
  public_url: `https://x/${aspect}.png`,
  width: 1080,
  height: 1080,
});
const all = (["1:1", "4:5", "9:16"] as Aspect[]).map(render);
const ok = { ok: true, issues: [] };

describe("canApprove", () => {
  it("is false without the 9:16 render", () => {
    const r = canApprove({ state: "draft", renders: [render("1:1"), render("4:5")], grounding: ok });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/9:16/);
  });
  it("is false when grounding failed", () => {
    expect(canApprove({ state: "draft", renders: all, grounding: { ok: false, issues: [] } }).ok).toBe(false);
  });
  it("is true with every aspect rendered and grounding ok", () => {
    expect(canApprove({ state: "draft", renders: all, grounding: ok }).ok).toBe(true);
  });
  it("honours a narrower required list", () => {
    expect(canApprove({ state: "draft", renders: [render("1:1")], grounding: ok }, ["1:1"]).ok).toBe(true);
  });
});

describe("nextStateForReview", () => {
  it("maps draft reviews", () => {
    expect(nextStateForReview("draft", "approve")).toBe("approved");
    expect(nextStateForReview("draft", "reject")).toBe("rejected");
    expect(nextStateForReview("draft", "request_changes")).toBe("changes_requested");
  });
  it("only drafts are reviewed", () => {
    expect(nextStateForReview("approved", "request_changes")).toBeInstanceOf(Error);
    expect(nextStateForReview("superseded", "approve")).toBeInstanceOf(Error);
  });
});

describe("editCreatesDraft", () => {
  it("is true for everything but draft", () => {
    expect(editCreatesDraft("approved")).toBe(true);
    expect(editCreatesDraft("changes_requested")).toBe(true);
    expect(editCreatesDraft("draft")).toBe(false);
  });
});

describe("planEstimateCount", () => {
  it("is posts/week x 4 weeks, spread on weekdays, capped", () => {
    expect(planEstimateCount("2026-11", 3, 20)).toBe(12);
    expect(planEstimateCount("2026-11", 5, 20)).toBe(20);
    expect(planEstimateCount("2026-11", 5, 8)).toBe(8);
  });
});
