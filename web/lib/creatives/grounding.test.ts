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
    const rev = "It was really fine and tasty";
    const r = run("hi", { inputs: inputs({ body: "Best ever by far" }), reviewText: rev });
    expect(r.issues.some((i) => i.reason === "review quote does not match")).toBe(true);
    expect(run("hi", { inputs: inputs({ body: "was  REALLY fine", subhead: "" }), reviewText: rev }).issues.some((i) => i.reason === "review quote does not match")).toBe(true); // 3 words
    expect(run("hi", { inputs: inputs({ body: "was really fine and", subhead: "" }), reviewText: rev }).ok).toBe(true);
    expect(run("hi", { inputs: inputs({ body: "really fine and tast", subhead: "" }), reviewText: rev }).ok).toBe(false); // word boundary
  });
  it("accepts a short review only when quoted whole", () => {
    expect(run("hi", { inputs: inputs({ body: "Great bread", subhead: "" }), reviewText: "Great bread." }).ok).toBe(true);
    expect(run("hi", { inputs: inputs({ body: "Great", subhead: "" }), reviewText: "Great bread" }).ok).toBe(false);
  });
  it("checks the review author line", () => {
    const base = { body: "was really fine and tasty" };
    const rev = "It was really fine and tasty";
    const bad = run("hi", { inputs: inputs({ ...base, subhead: "Jane D." }), reviewText: rev, reviewAuthor: "John S." });
    expect(bad.issues.some((i) => i.reason === "review author does not match")).toBe(true);
    expect(run("hi", { inputs: inputs({ ...base, subhead: "jane  d." }), reviewText: rev, reviewAuthor: "Jane D." }).ok).toBe(true);
  });
});

const reasons = (r: { issues: { reason: string }[] }) => r.issues.map((i) => i.reason);
const withForbidden = () =>
  profile((p) => {
    p.claims.forbidden = [F("Cheapest in town"), F("100% satisfaction guaranteed")];
    p.voice.dont = [F("no hype words")];
  });

describe("forbidden claims", () => {
  it("never counts as evidence or citation", () => {
    const pr = withForbidden();
    const r = run("Cheapest in town!", { profile: pr, claimsUsed: [{ text: "Cheapest in town", path: "claims.forbidden[0]" }] });
    expect(r.ok).toBe(false);
    expect(reasons(r)).toEqual(expect.arrayContaining(["cited path is a forbidden claim", "contains a forbidden claim"]));
    const r2 = run("100% satisfaction guaranteed", { profile: pr, claimsUsed: [{ text: "100%", path: "claims.forbidden[1]" }] });
    expect(r2.ok).toBe(false);
    expect(run("x", { profile: pr, claimsUsed: [{ text: "no hype", path: "voice.dont[0]" }] }).ok).toBe(false);
  });
  it("is excluded from the corpus", () => {
    const c = factCorpus(withForbidden(), []);
    expect([...c.confirmed, ...c.unconfirmed].join("|")).not.toContain("cheapest");
    expect(run("Get 100% satisfaction", { profile: withForbidden() }).ok).toBe(false);
  });
  it("blocks a forbidden value in headline, cta and caption", () => {
    const pr = withForbidden();
    expect(reasons(run("ok", { profile: pr, inputs: inputs({ cta_text: "Cheapest in town" }) }))).toContain("contains a forbidden claim");
    expect(reasons(run("ok", { profile: pr, inputs: inputs({ headline: "The CHEAPEST  in town" }) }))).toContain("contains a forbidden claim");
  });
});

describe("citation scope", () => {
  it("one citation does not cover a different keyword", () => {
    const r = run("We are family-owned. Award-winning!", { claimsUsed: [{ text: "family-owned", path: "claims.allowed[0]" }] });
    expect(r.ok).toBe(false);
    expect(r.issues[0].text).toBe("Award-winning!");
  });
  it("a one-letter citation covers nothing", () => {
    const r = run("Our best bread", { claimsUsed: [{ text: "a", path: "claims.allowed[0]" }] });
    expect(r.ok).toBe(false);
  });
  it("since + number citation still works", () => {
    expect(run("Baking since 1971", { claimsUsed: [{ text: "1971", path: "business.founded" }] }).ok).toBe(true);
  });
  it("keyword issue stores the sentence", () => {
    expect(run("Fresh daily. We are the best around.").issues[0].text).toBe("We are the best around.");
  });
});

describe("number kinds", () => {
  const hours = profile((p) => (p.business.hours.mon = F("8am-5pm")));
  it("hours do not ground prices or percents", () => {
    expect(run("Only $8 today", { profile: hours, products: [] }).ok).toBe(false);
    expect(run("Save 5% now", { profile: hours, products: [] }).ok).toBe(false);
  });
  it("a price does not ground a percent or year", () => {
    expect(run("Save 12% now").ok).toBe(false);
    expect(run("Since 2012", { profile: profile((p) => (p.business.tagline = F("From $2012")) ) , products: [] }).ok).toBe(false);
  });
  it("percent grounds a percent", () => {
    expect(run("Save 20% now", { profile: profile((p) => (p.business.tagline = F("20% off for seniors"))) }).ok).toBe(true);
  });
  it("thousands separators and bare price fields", () => {
    expect(run("From $1200", { products: [product({ price: "$1,200" })] }).ok).toBe(true);
    expect(run("Loaf at $12.95", { products: [product({ price: "12.95" })] }).ok).toBe(true);
  });
  it("phones compare the last 10 digits", () => {
    const pr = profile((p) => (p.business.contact.phone = F("(555) 123-4567")));
    expect(run("Call +1 555-123-4567", { profile: pr }).ok).toBe(true);
    expect(run("Call 555-123-9999", { profile: pr }).ok).toBe(false);
  });
  it("current and next year are exempt", () => {
    const y = new Date().getFullYear();
    expect(run(`Summer ${y} menu`).ok).toBe(true);
    expect(run(`Summer ${y + 1} menu`).ok).toBe(true);
    expect(run("Summer 1985 menu").ok).toBe(false);
  });
});

describe("cta and spellings", () => {
  it("scans cta_text", () => {
    expect(run("hi", { inputs: inputs({ cta_text: "Only $5 today" }), products: [] }).ok).toBe(false);
  });
  it.each(["family owned", "same day service", "No. 1 in town", "number one choice", "24-7 help", "24 7 help", "Family‑Owned", "Same‑Day", "24/7"])(
    "flags spelling variant %s",
    (t) => {
      expect(run(t).ok).toBe(false);
    },
  );
  it("does not flag look-alikes", () => {
    expect(run("Open 2470 Main St, casino 1, nobody").ok).toBe(true);
  });
});

describe("unconfirmed citation", () => {
  it("warns but passes", () => {
    const pr = profile((p) => (p.claims.allowed = [F("Family-owned and operated", false)]));
    const r = run("We are family-owned", { profile: pr, claimsUsed: [{ text: "family-owned", path: "claims.allowed[0]" }] });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([expect.objectContaining({ reason: "matches an unconfirmed fact", warning: true })]);
  });
});
