/**
 * select.test.ts — unit tests for the pure generation-selection helpers (resume set, budget, seeds).
 *
 * Inputs:  plan concepts, creative status rows, Brand Brain fixtures
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { EMPTY_PROFILE, type BrandProfileData, type ProductSnapshot } from "@/lib/clients/types";
import {
  completeInputs,
  conceptForCreative,
  capToMaxPerPlan,
  conceptsToGenerate,
  creativeForConcept,
  creativeUnitFor,
  guardReviewConcepts,
  imageNeeded,
  needsBackground,
  nextBudgetCheck,
  pendingCount,
  reviewSource,
  seedVisuals,
} from "./select";
import type { Concept, CreativeStatus } from "./types";

const NOW = new Date("2026-11-02T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const concept = (i: number, over: Partial<Concept> = {}): Concept => ({
  slot_date: `2026-11-${String(i + 2).padStart(2, "0")}`,
  platforms: ["instagram"],
  template_key: "tip-quote",
  kind: "image",
  title: `c${i}`,
  angle: "a",
  product_id: null,
  claim_refs: [],
  cta_kind: "book",
  hashtags_seed: [],
  ...over,
});
const plan = { concepts: [0, 1, 2, 3, 4, 5].map((i) => concept(i)) };
const row = (concept_index: number | null, status: CreativeStatus, minutesAgo = 1) => ({
  concept_index,
  status,
  updated_at: ago(minutesAgo),
});

describe("conceptsToGenerate", () => {
  it("returns every index when there are no creatives", () => {
    expect(conceptsToGenerate(plan, [], NOW)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("includes missing, failed and stale rendering; excludes ready and fresh rendering", () => {
    const cs = [
      row(0, "ready"),
      row(1, "failed"),
      row(2, "rendering", 16), // stale (> 15 min)
      row(3, "rendering", 5), // fresh: another run is on it
      // 4 missing
      row(5, "ready"),
    ];
    expect(conceptsToGenerate(plan, cs, NOW)).toEqual([1, 2, 4]);
  });
  it("treats a never-started draft creative as needing work", () => {
    expect(conceptsToGenerate({ concepts: [concept(0)] }, [row(0, "draft")], NOW)).toEqual([0]);
  });
  it("a healthy creative for an index wins over an older failed one", () => {
    expect(conceptsToGenerate({ concepts: [concept(0)] }, [row(0, "failed", 30), row(0, "ready", 2)], NOW)).toEqual([]);
  });
  it("ignores creatives without a concept index or outside the concept list", () => {
    expect(conceptsToGenerate({ concepts: [concept(0)] }, [row(null, "ready"), row(7, "ready")], NOW)).toEqual([0]);
  });
  it("rendering exactly at the 15 min boundary is not yet stale", () => {
    expect(conceptsToGenerate({ concepts: [concept(0)] }, [row(0, "rendering", 15)], NOW)).toEqual([]);
  });
});

describe("capToMaxPerPlan (Ruling 32)", () => {
  const c = (i: number) => ({ concept_index: i });
  it("drops concept indexes at or past the cap", () => {
    expect(capToMaxPerPlan([0, 1, 2, 3], [], 2)).toEqual([0, 1]);
  });
  it("starts new creatives only while the plan holds fewer than max; resumes are always kept", () => {
    expect(capToMaxPerPlan([1, 3, 4], [c(0), c(1), c(2)], 4)).toEqual([1, 3]);
    expect(capToMaxPerPlan([0, 3], [c(0), c(1), c(2), c(5)], 4)).toEqual([0]);
  });
});

describe("creativeForConcept", () => {
  it("returns the most recently updated creative for that index", () => {
    const a = { id: "a", ...row(1, "failed", 30) };
    const b = { id: "b", ...row(1, "failed", 3) };
    expect(creativeForConcept([a, b, { id: "c", ...row(2, "ready") }], 1)?.id).toBe("b");
    expect(creativeForConcept([a], 4)).toBeNull();
  });
});

describe("nextBudgetCheck", () => {
  it("allows the next creative only when it fits under the cap", () => {
    expect(nextBudgetCheck(0, 0.84, 0.056)).toBe(true);
    expect(nextBudgetCheck(0.8, 0.84, 0.056)).toBe(false);
    expect(nextBudgetCheck(0.784, 0.84, 0.056)).toBe(true); // lands exactly on the cap
    expect(nextBudgetCheck(0, 0, 0.003)).toBe(false);
  });
});

describe("imageNeeded / creativeUnitFor", () => {
  const plan = { ai_backgrounds: true };
  const assets = new Set(["bg1"]);
  it("a tip-quote with no background asset needs one image", () => {
    expect(imageNeeded({ templateKey: "tip-quote", inputs: { background_asset_id: null }, plan, assetIds: assets })).toBe(true);
    expect(creativeUnitFor({ templateKey: "tip-quote", inputs: {}, plan, assetIds: assets }, true, 0.053)).toBeCloseTo(0.056);
  });
  it("an existing background asset means no image cost", () => {
    const i = { background_asset_id: "bg1" };
    expect(imageNeeded({ templateKey: "tip-quote", inputs: i, plan, assetIds: assets })).toBe(false);
    expect(creativeUnitFor({ templateKey: "tip-quote", inputs: i, plan, assetIds: assets }, true, 0.053)).toBeCloseTo(0.003);
  });
  it("a background id whose asset is gone needs a new image", () => {
    expect(imageNeeded({ templateKey: "offer", inputs: { background_asset_id: "gone" }, plan, assetIds: assets })).toBe(true);
  });
  it("product-hero needs none (unless a prompt is set); plan toggle off and no OpenAI cost nothing", () => {
    expect(creativeUnitFor({ templateKey: "product-hero", inputs: {}, plan, assetIds: assets }, true, 0.053)).toBeCloseTo(0.003);
    expect(imageNeeded({ templateKey: "product-hero", inputs: { background_prompt: "sky" }, plan, assetIds: assets })).toBe(true);
    expect(imageNeeded({ templateKey: "offer", inputs: {}, plan: { ai_backgrounds: false }, assetIds: assets })).toBe(false);
    expect(creativeUnitFor({ templateKey: "offer", inputs: {}, plan, assetIds: assets }, false, 0.053)).toBeCloseTo(0.003);
  });
});

describe("pendingCount", () => {
  it("counts concepts without a ready creative", () => {
    expect(pendingCount(plan, [row(0, "ready"), row(1, "failed"), row(2, "rendering")])).toBe(5);
    expect(pendingCount({ concepts: [concept(0)] }, [row(0, "ready")])).toBe(0);
  });
});

describe("needsBackground", () => {
  it("follows the template default, an explicit prompt and the plan toggle", () => {
    expect(needsBackground("tip-quote", { background_prompt: null }, null)).toBe(true);
    expect(needsBackground("product-hero", { background_prompt: null }, null)).toBe(false);
    expect(needsBackground("product-hero", { background_prompt: "sky" }, null)).toBe(true);
    expect(needsBackground("offer", {}, { ai_backgrounds: false })).toBe(false);
    expect(needsBackground("offer", {}, { ai_backgrounds: true })).toBe(true);
  });
});

const profile = (): BrandProfileData => {
  const p = structuredClone(EMPTY_PROFILE);
  const f = (value: string) => ({
    value,
    source: { kind: "website" as const, url: null, page_id: null, quote: null },
    confirmed: true,
  });
  p.visuals.colors.primary = f("#C50711");
  p.visuals.logo_asset_id = "logo1";
  p.claims.allowed = [
    f("Same-Day Service"),
    f("Over 13,511+ 5-Star Reviews"),
    f("Customers say: they were on time and very friendly"),
  ];
  p.ctas = [{ ...f(""), value: { text: "Call Today", kind: "call" } }];
  return p;
};
const product = (id: string, imgs: string[]): ProductSnapshot => ({
  id,
  name: id,
  description: null,
  price: null,
  category: null,
  featured: true,
  sort: 0,
  image_asset_ids: imgs,
  source: { kind: "operator" },
  confirmed: true,
});
const asset = (id: string, over: Partial<{ kind: string; origin: string; tags: string[] }> = {}) => ({
  id,
  kind: "photo",
  origin: "website",
  tags: [] as string[],
  ...over,
});

describe("seedVisuals", () => {
  const assets = [
    asset("logo1", { kind: "logo" }),
    asset("r1", { origin: "render" }),
    asset("p1"),
    asset("p2"),
    asset("p3"),
    asset("p4"),
  ];
  it("takes colours and logo from the Brand Brain, photos from the product", () => {
    const s = seedVisuals(profile(), [product("pr", ["p2"])], "pr", assets);
    expect(s.colors).toEqual({ primary: "#C50711", accent: "", background: "", text: "" });
    expect(s.logo_asset_id).toBe("logo1");
    expect(s.photo_asset_ids).toEqual(["p2"]);
  });
  it("falls back to the first 3 non-render photos when the product has none", () => {
    expect(seedVisuals(profile(), [product("pr", [])], "pr", assets).photo_asset_ids).toEqual(["p1", "p2", "p3"]);
    expect(seedVisuals(profile(), [], null, assets).photo_asset_ids).toEqual(["p1", "p2", "p3"]);
  });
  it("drops a logo id that is not a ready asset", () => {
    expect(seedVisuals(profile(), [], null, [asset("p1")]).logo_asset_id).toBeNull();
  });
});

describe("completeInputs", () => {
  it("fills defaults and keeps provided values", () => {
    const seed = {
      colors: { primary: "#000000", accent: "", background: "", text: "" },
      logo_asset_id: null,
      photo_asset_ids: ["p1"],
    };
    const c = completeInputs({ headline: "Hi", photo_asset_ids: [] }, seed);
    expect(c.headline).toBe("Hi");
    expect(c.subhead).toBe("");
    expect(c.photo_asset_ids).toEqual([]);
    expect(c.colors.primary).toBe("#000000");
    expect(c.background_asset_id).toBeNull();
    expect(c.cta_kind).toBe("website");
  });
});

describe("conceptForCreative", () => {
  const creative = {
    plan_id: "pl",
    concept_index: 1,
    kind: "image" as const,
    slot_date: "2026-11-09",
    platforms: ["facebook" as const],
    template_key: "offer" as const,
    product_id: null,
    title: "T",
    brief: "Winter tune-up",
  };
  it("uses the plan concept with the creative's own platforms/template", () => {
    const c = conceptForCreative(creative, plan, profile());
    expect(c.title).toBe("c1");
    expect(c.platforms).toEqual(["facebook"]);
    expect(c.template_key).toBe("offer");
  });
  it("synthesises a concept for a single post from its brief", () => {
    const c = conceptForCreative({ ...creative, plan_id: null, concept_index: null }, null, profile());
    expect(c.angle).toBe("Winter tune-up");
    expect(c.cta_kind).toBe("call");
    expect(c.slot_date).toBe("2026-11-09");
  });
});

const review = (body: string, author: string) => ({ value: { body, author }, source: { kind: "google_maps" as const }, confirmed: true });

// Ruling 30: these replaced the reviewSourceText tests, which accepted review-like CLAIMS as review sources.
describe("reviewSource", () => {
  it("prefers the review that contains the quote, else the first usable review; author comes with it", () => {
    const p = profile();
    p.reviews = [review("Fast and fair pricing", "Sam T."), review("They were on time and very friendly", "Jane D.")];
    expect(reviewSource(p, "on time and very friendly")).toEqual({ text: "They were on time and very friendly", author: "Jane D." });
    expect(reviewSource(p, "made up quote")).toEqual({ text: "Fast and fair pricing", author: "Sam T." });
  });
  it("ignores review-like claims: a brain without reviews has no review source", () => {
    const p = profile(); // claims include "Over 13,511+ 5-Star Reviews" and "Customers say: ..."
    p.claims.allowed.push({ ...p.claims.allowed[0], value: "Rated 4.9 stars on Google" });
    expect(reviewSource(p, "they were on time and very friendly")).toBeNull();
  });
  it("skips reviews without a body or an author", () => {
    const p = profile();
    p.reviews = [review("Great work", ""), review("  ", "Jane D.")];
    expect(reviewSource(p, "")).toBeNull();
  });
});

describe("guardReviewConcepts", () => {
  const list = [
    concept(0, { template_key: "review", product_id: "p1", kind: "image" }),
    concept(1, { template_key: "review" }),
    concept(2),
  ];
  it("converts review concepts when the facts hold no review quote", () => {
    const r = guardReviewConcepts(list, EMPTY_PROFILE);
    expect(r.converted).toBe(2);
    expect(r.concepts.map((c) => c.template_key)).toEqual(["product-hero", "tip-quote", "tip-quote"]);
    expect(r.concepts[0].title).toBe("c0");
    expect(r.concepts[0].slot_date).toBe(list[0].slot_date);
  });
  it("converts them when only review-like claims exist (no reviews[n] entry)", () => {
    const p = profile(); // "Over 13,511+ 5-Star Reviews", "Customers say: ..."
    p.claims.allowed.push({ ...p.claims.allowed[0], value: "Free system review with every tune-up" });
    expect(guardReviewConcepts(list, p).converted).toBe(2);
  });
  it("leaves them alone when a real review (body + author) exists", () => {
    const profile: BrandProfileData = { ...EMPTY_PROFILE, reviews: [review("Customers love us, five stars", "Jane D.")] };
    const r = guardReviewConcepts(list, profile);
    expect(r.converted).toBe(0);
    expect(r.concepts).toBe(list);
  });
});
