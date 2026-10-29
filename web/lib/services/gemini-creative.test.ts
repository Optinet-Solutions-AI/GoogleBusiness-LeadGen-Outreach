/**
 * gemini-creative.test.ts — zod output schemas and the pure concept repair.
 *
 * Inputs:  hand-written concepts / copy outputs
 * Outputs: assertions
 * Used by: vitest
 */
import { describe, expect, it } from "vitest";
import { ConceptsOutput, CopyOutput, repairConcepts } from "./gemini-creative";
import type { Concept } from "@/lib/creatives/types";

const concept = (over: Partial<Concept> = {}): Concept => ({
  slot_date: "2026-11-02",
  platforms: ["instagram"],
  template_key: "tip-quote",
  kind: "image",
  title: "t",
  angle: "a",
  product_id: null,
  claim_refs: [],
  cta_kind: "call",
  hashtags_seed: ["a", "b", "c"],
  ...over,
});

describe("output schemas", () => {
  it("accepts a valid concepts output and rejects a bad template", () => {
    expect(ConceptsOutput.safeParse({ concepts: [concept()] }).success).toBe(true);
    expect(ConceptsOutput.safeParse({ concepts: [concept({ template_key: "nope" as never })] }).success).toBe(false);
  });
  it("accepts a valid copy output and rejects a missing caption list", () => {
    const ok = {
      headline: "h", subhead: "s", cta_text: "Call", body: null,
      captions: [{ platform: "instagram", caption: "c", hashtags: ["#a"] }],
      claims_used: [{ text: "x", path: "claims.allowed[0]" }],
    };
    expect(CopyOutput.safeParse(ok).success).toBe(true);
    expect(CopyOutput.safeParse({ ...ok, captions: undefined }).success).toBe(false);
    expect(CopyOutput.safeParse({ ...ok, captions: [{ platform: "tiktok", caption: "c", hashtags: [] }] }).success).toBe(false);
  });
});

describe("repairConcepts", () => {
  const slots = ["2026-11-02", "2026-11-04", "2026-11-06"];
  it("reassigns out-of-range or duplicate slot dates in order and pins products", () => {
    const out = repairConcepts(
      [concept({ slot_date: "2026-11-02" }), concept({ slot_date: "2030-01-01", title: "b" }), concept({ slot_date: "2026-11-02", title: "c" })],
      slots,
      ["p1", null, "p3"],
    );
    expect(out.map((c) => c.slot_date)).toEqual(slots);
    expect(out.map((c) => c.product_id)).toEqual(["p1", null, "p3"]);
  });
  it("drops carousels on non-carousel templates and review when disallowed", () => {
    const out = repairConcepts([concept({ template_key: "review", kind: "carousel" })], ["2026-11-02"], [null]);
    expect(out[0].kind).toBe("image");
    const out2 = repairConcepts([concept({ template_key: "review" })], ["2026-11-02"], [null], { allowReview: false });
    expect(out2[0].template_key).toBe("tip-quote");
  });
  it("keeps carousels on supporting templates", () => {
    expect(repairConcepts([concept({ kind: "carousel" })], ["2026-11-02"], [null])[0].kind).toBe("carousel");
  });
});
