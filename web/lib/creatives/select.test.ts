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
  conceptsToGenerate,
  creativeForConcept,
  needsBackground,
  nextBudgetCheck,
  pendingCount,
  reviewSourceText,
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

describe("reviewSourceText", () => {
  it("prefers the review-like claim that contains the quote, else the first review-like claim", () => {
    const p = profile();
    expect(reviewSourceText(p, "they were on time and very friendly")).toBe(
      "Customers say: they were on time and very friendly",
    );
    expect(reviewSourceText(p, "made up quote")).toBe("Over 13,511+ 5-Star Reviews");
  });
  it("returns null when the Brand Brain has no review-like fact", () => {
    const p = profile();
    p.claims.allowed = p.claims.allowed.slice(0, 1);
    expect(reviewSourceText(p, "x")).toBeNull();
  });
});
