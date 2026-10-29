/**
 * grounding.test.ts — unit tests for the caption grounding check against the brand brain.
 *
 * Inputs:  hand-built profile / product / copy fixtures
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { checkGrounding, extractPatterns, factCorpus } from "./grounding";
import { EMPTY_PROFILE, type BrandProfileData, type ProductSnapshot } from "@/lib/clients/types";
import type { CreativeInputs } from "./types";

const src = { kind: "operator" as const };
const F = (value: string, confirmed = true) => ({ value, source: src, confirmed });

const profile = (over: (p: BrandProfileData) => void = () => {}): BrandProfileData => {
  const p = structuredClone(EMPTY_PROFILE);
  p.business.founded = F("1971");
  p.claims.allowed = [F("Family-owned and operated")];
  over(p);
  return p;
};
const product = (over: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
  id: "prod1",
  name: "Sourdough loaf",
  description: "Slow-fermented bread",
  price: "$12.95",
  category: "Bread",
  featured: true,
  sort: 0,
  image_asset_ids: [],
  source: src,
  confirmed: true,
  ...over,
});
const inputs = (over: Partial<CreativeInputs> = {}): CreativeInputs => ({
  headline: "Fresh bread",
  subhead: "Baked daily",
  cta_text: "Order",
  cta_kind: "visit",
  colors: { primary: "#000", accent: "#111", background: "#fff", text: "#222" },
  logo_asset_id: null,
  photo_asset_ids: [],
  background_asset_id: null,
  background_prompt: null,
  ...over,
});
const run = (caption: string, extra: Partial<Parameters<typeof checkGrounding>[0]> = {}) =>
  checkGrounding({
    copy: { instagram: { caption, hashtags: [] } },
    inputs: inputs(),
    claimsUsed: [],
    profile: profile(),
    products: [product()],
    ...extra,
  });

describe("extractPatterns", () => {
  it("finds prices, percents, years, phones and keywords", () => {
    const k = extractPatterns("Only $12.95 or 12 dollars, 20% or 20 percent off since 1999. Call 555-123-4567. Award winning").map(
      (x) => x.kind,
    );
    expect(k).toEqual(expect.arrayContaining(["price", "percent", "year", "phone", "keyword"]));
  });
});

describe("factCorpus", () => {
  it("splits by confirmed flag", () => {
    const c = factCorpus(
      profile((p) => (p.business.tagline = F("Tasty Things", false))),
      [product({ confirmed: false })],
    );
    expect(c.confirmed).toContain("1971");
    expect(c.unconfirmed).toContain("tasty things");
    expect(c.unconfirmed).toContain("$12.95");
  });
});

describe("checkGrounding", () => {
  it("fails a price that exists nowhere", () => {
    const r = run("Loaves from $89 today", { products: [] });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ platform: "instagram", reason: "not in brand brain" });
  });
  it("does not match $8 inside $89", () => {
    const r = run("Only $8 today", { profile: profile((p) => (p.business.tagline = F("From $89"))) , products: [] });
    expect(r.issues.some((i) => i.reason === "not in brand brain")).toBe(true);
  });
  it("passes a product price", () => {
    expect(run("Our loaf is $12.95 a month").ok).toBe(true);
  });
  it("passes a year found in a confirmed fact", () => {
    const r = run("Baking since 1971", { claimsUsed: [{ text: "since 1971", path: "business.founded" }] });
    // citation text must be in the value at its path -> "since 1971" is not; use the bare year
    expect(r.ok).toBe(false);
    const r2 = run("Baking since 1971", { claimsUsed: [{ text: "1971", path: "business.founded" }] });
    expect(r2.ok).toBe(true);
  });
  it("flags a claim keyword with no citation", () => {
    const r = run("Our award-winning bread");
    expect(r.ok).toBe(false);
    expect(r.issues[0].reason).toBe("unsupported claim keyword without citation");
  });
  it("fails a claims_used text missing at its path", () => {
    const r = run("Hello there", { claimsUsed: [{ text: "licensed", path: "claims.allowed[0]" }] });
    expect(r.ok).toBe(false);
    expect(r.issues[0].reason).toBe("cited path does not contain this text");
  });
  it("passes family-owned cited to claims.allowed[0]", () => {
    const r = run("We are family-owned", { claimsUsed: [{ text: "family-owned", path: "claims.allowed[0]" }] });
    expect(r.ok).toBe(true);
  });
  it("accepts product paths and product ids", () => {
    expect(run("x", { claimsUsed: [{ text: "$12.95", path: "products[0].price" }] }).ok).toBe(true);
    expect(run("x", { claimsUsed: [{ text: "sourdough", path: "prod1" }] }).ok).toBe(true);
  });
  it("treats prototype paths as not containing the text", () => {
    expect(run("x", { claimsUsed: [{ text: "a", path: "__proto__.x" }] }).ok).toBe(false);
  });
  it("warns but passes when only an unconfirmed fact matches", () => {
    const r = run("Loaves for $12.95", { products: [product({ confirmed: false })] });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([expect.objectContaining({ reason: "matches an unconfirmed fact", warning: true })]);
  });
  it("fails a review quote that does not match", () => {
    const r = run("hi", { inputs: inputs({ body: "Best ever" }), reviewText: "It was fine" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.reason === "review quote does not match")).toBe(true);
    expect(run("hi", { inputs: inputs({ body: "was  FINE" }), reviewText: "It was fine" }).ok).toBe(true);
  });
});
