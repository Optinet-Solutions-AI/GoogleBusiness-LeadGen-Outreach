/**
 * gemini-creative.test.ts — zod output schemas and the pure concept repair.
 *
 * Inputs:  hand-written concepts / copy outputs
 * Outputs: assertions
 * Used by: vitest
 */
import { describe, expect, it, vi } from "vitest";
import { conceptMixWarning, ConceptsOutput, CopyLimitError, CopyOutput, mapCtaKind, renderFacts, repairConcepts, writeCopy } from "./gemini-creative";
import { EMPTY_PROFILE } from "@/lib/clients/types";

// Mimic the real structuredCall loop (one retry) over canned model outputs.
const canned: unknown[] = [];
let calls = 0;
vi.mock("@/lib/services/gemini-brand", () => ({
  structuredCall: async (opts: { zod: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: { issues: { message: string }[] } } } }) => {
    let last = "";
    for (let i = 0; i < 2; i++) {
      calls++;
      const r = opts.zod.safeParse(canned.shift());
      if (r.success) return { output: r.data, usage: { prompt_tokens: 1, completion_tokens: 1, model: "m" } };
      last = r.error?.issues.map((x) => x.message).join("; ") ?? "";
    }
    throw new Error(`failed: ${last}`);
  },
}));
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

describe("neverBlock", () => {
  it("renders forbidden and dont fact values", async () => {
    const { neverBlock } = await import("./gemini-creative");
    const { EMPTY_PROFILE } = await import("@/lib/clients/types");
    const f = (value: string) => ({ value, source: { kind: "operator" as const }, confirmed: true });
    const out = neverBlock({
      ...EMPTY_PROFILE,
      claims: { allowed: [], forbidden: [f("lowest prices in town")] },
      voice: { ...EMPTY_PROFILE.voice, dont: [f("use slang")] },
    });
    expect(out).toContain("lowest prices in town");
    expect(out).toContain("use slang");
    expect(out).not.toContain("[object Object]");
  });
});


describe("repairConcepts fixes", () => {
  it("strips voice.* and forbidden claim_refs and maps cta_kind", () => {
    const raw = { ...concept(), cta_kind: "Learn more", claim_refs: ["voice.do[0]", "claims.allowed[1]", "claims.forbidden[0]", "voice.sample_lines[2]"] };
    const out = repairConcepts([raw], ["2026-11-02"], [null]);
    expect(out[0].claim_refs).toEqual(["claims.allowed[1]"]);
    expect(out[0].cta_kind).toBe("website");
  });
  it("maps common cta phrases", () => {
    expect(mapCtaKind("Call us")).toBe("call");
    expect(mapCtaKind("Book now")).toBe("book");
    expect(mapCtaKind("message")).toBe("message");
    expect(mapCtaKind("visit")).toBe("visit");
  });
});

describe("renderFacts", () => {
  it("lists voice only under writing guidance, never as citable paths", () => {
    const f = (value: string) => ({ value, source: { kind: "operator" as const }, confirmed: true });
    const text = renderFacts(
      { ...EMPTY_PROFILE, voice: { ...EMPTY_PROFILE.voice, tone: [f("warm")], sample_lines: [f("Your comfort is our mission.")] }, claims: { allowed: [f("Same-day service")], forbidden: [] } },
      [],
    );
    expect(text).not.toMatch(/voice\./);
    expect(text).toContain("claims.allowed[0]: Same-day service");
    const [facts, guidance] = text.split("# WRITING GUIDANCE");
    expect(facts).not.toContain("mission");
    expect(guidance).toContain("Your comfort is our mission.");
  });
});

describe("writeCopy caption limits", () => {
  const base = { headline: "h", subhead: "s", cta_text: "Call", claims_used: [] };
  const run = () =>
    writeCopy({
      profile: EMPTY_PROFILE,
      products: [],
      concept: concept(),
      platforms: ["facebook"],
      templateKey: "tip-quote",
      kind: "image",
    });
  it("retries once on an over-long caption and succeeds", async () => {
    calls = 0;
    canned.length = 0;
    canned.push(
      { ...base, captions: [{ platform: "facebook", caption: "x".repeat(2100), hashtags: [] }] },
      { ...base, captions: [{ platform: "facebook", caption: "ok", hashtags: [] }] },
    );
    const r = await run();
    expect(calls).toBe(2);
    expect(r.copy.facebook?.caption).toBe("ok");
  });
  it("throws CopyLimitError when still over the limit", async () => {
    canned.length = 0;
    const bad = { ...base, captions: [{ platform: "facebook", caption: "x".repeat(2100), hashtags: [] }] };
    canned.push(bad, bad);
    await expect(run()).rejects.toBeInstanceOf(CopyLimitError);
  });
  it("retries once when a requested platform has no caption, then succeeds", async () => {
    calls = 0;
    canned.length = 0;
    canned.push(
      { ...base, captions: [{ platform: "instagram", caption: "wrong platform", hashtags: [] }] },
      { ...base, captions: [{ platform: "facebook", caption: "ok", hashtags: [] }] },
    );
    const r = await run();
    expect(calls).toBe(2);
    expect(r.copy.facebook?.caption).toBe("ok");
  });
  it("throws CopyLimitError when a requested platform is still missing after the retry", async () => {
    canned.length = 0;
    const bad = { ...base, captions: [{ platform: "facebook", caption: "   ", hashtags: [] }] };
    canned.push(bad, bad);
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopyLimitError);
    expect((err as CopyLimitError).violations).toEqual([{ platform: "facebook", reason: "caption missing" }]);
  });
  it("trims extra hashtags", async () => {
    canned.length = 0;
    canned.push({ ...base, captions: [{ platform: "facebook", caption: "ok", hashtags: ["#a", "#b", "#c", "#d", "#e", "#f", "#g"] }] });
    expect((await run()).copy.facebook?.hashtags).toHaveLength(5);
  });
});

describe("conceptMixWarning", () => {
  const mk = (...keys: string[]) => keys.map((template_key) => ({ template_key })) as never;
  it("warns when more than 60% share a template", () => {
    expect(conceptMixWarning(mk("product-hero", "product-hero", "product-hero", "tip-quote"))).toMatch(/3 of 4/);
  });
  it("is null for a healthy mix", () => {
    expect(conceptMixWarning(mk("product-hero", "product-hero", "tip-quote", "offer"))).toBeNull();
  });
});
