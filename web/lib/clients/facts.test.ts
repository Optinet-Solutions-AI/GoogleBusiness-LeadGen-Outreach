/**
 * facts.test.ts — unit tests for sourced-fact validation, profile assembly, draft merge and diff.
 *
 * Inputs:  hand-built ExtractedFact / PageRef / BrandProfileData fixtures
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { validateFacts, assembleProfile, mergeDraft, diffPaths } from "./facts";
import { EMPTY_PROFILE, type ExtractedFact, type PageRef, type BrandProfileData } from "./types";

const pages: PageRef[] = [
  { id: "p1", url: "https://acme.test/about", text: "Family-run &amp; local since   2004. Free quotes." },
];
const ef = (over: Partial<ExtractedFact> = {}): ExtractedFact => ({
  path: "business.tagline",
  value: "Local since 2004",
  source: "p1",
  quote: "free quotes",
  ...over,
});

describe("validateFacts", () => {
  it("keeps a quoted fact whose quote appears in its page", () => {
    const f = ef({ quote: "family-run & local since 2004" });
    const r = validateFacts([f], pages);
    expect(r.kept).toEqual([f]);
    expect(r.dropped).toEqual([]);
  });
  it("drops quote_not_found", () => {
    const r = validateFacts([ef({ quote: "cheapest in town" })], pages);
    expect(r.kept).toEqual([]);
    expect(r.dropped[0].reason).toBe("quote_not_found");
  });
  it("drops unknown_page", () => {
    const r = validateFacts([ef({ source: "nope" })], pages);
    expect(r.dropped[0].reason).toBe("unknown_page");
  });
  it("drops missing_quote for a page source whose value is not in the text either", () => {
    const r = validateFacts([ef({ value: "Since 1999", quote: null }), ef({ value: "Since 1999", quote: "  " })], pages);
    expect(r.dropped.map((d) => d.reason)).toEqual(["missing_quote", "missing_quote"]);
  });

  const intake: PageRef = { id: "operator", url: null, text: "Sells: wedding cakes\nNever claim: cheapest in town" };
  const maps: PageRef = { id: "google_maps", url: null, text: "Name: Acme Bakery\nPhone: (555) 010-2000" };

  it("keeps an operator fact whose quote is in the intake text", () => {
    const f = ef({ path: "claims.forbidden[]", value: "cheapest in town", source: "operator", quote: "Never claim: cheapest in town" });
    expect(validateFacts([f], [...pages, intake]).kept).toEqual([f]);
  });
  it("drops an operator fact whose quote is not in the intake text", () => {
    const f = ef({ source: "operator", quote: "we are the best" });
    expect(validateFacts([f], [...pages, intake]).dropped[0].reason).toBe("quote_not_found");
  });
  it("drops operator and google_maps facts when that input is absent", () => {
    const r = validateFacts(
      [ef({ source: "operator", quote: "Sells: wedding cakes" }), ef({ source: "google_maps", quote: null })],
      pages,
    );
    expect(r.kept).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["source_absent", "source_absent"]);
  });
  it("accepts a short value found in the cited text when the quote is null (google_maps)", () => {
    const f = ef({ path: "business.contact.phone", value: "(555)  010-2000", source: "google_maps", quote: null });
    expect(validateFacts([f], [...pages, maps]).kept).toEqual([f]);
  });
  it("does not value-match long values or values missing from the cited text", () => {
    const long = ef({ path: "business.description", value: "Acme Bakery ".repeat(5), source: "google_maps", quote: null });
    const other = ef({ path: "business.name", value: "Acme Plumbing", source: "google_maps", quote: null });
    const r = validateFacts([long, other], [...pages, maps]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["missing_quote", "missing_quote"]);
  });
  it("does not fall back to the value when a quote is given but not found", () => {
    const f = ef({ path: "business.name", value: "Acme Bakery", source: "google_maps", quote: "Acme Bakery & Cafe" });
    expect(validateFacts([f], [...pages, maps]).dropped[0].reason).toBe("quote_not_found");
  });
});

describe("assembleProfile", () => {
  it("sets scalar and list paths and never confirms AI-written facts", () => {
    const p = assembleProfile(
      [
        ef(),
        ef({ path: "claims.allowed[]", value: "free quotes" }),
        ef({ path: "claims.allowed[]", value: "local" }),
        ef({ path: "claims.forbidden[]", value: "cheapest", source: "operator", quote: null }),
        ef({ path: "business.contact.phone", value: "555", source: "google_maps", quote: null }),
        ef({ path: "bogus.path", value: 1 }),
      ],
      [...pages, { id: "operator", url: null, text: "Never claim: cheapest" }],
    );
    expect(p.business.tagline).toEqual({
      value: "Local since 2004",
      source: { kind: "website", url: "https://acme.test/about", page_id: "p1", quote: "free quotes" },
      confirmed: false,
    });
    expect(p.claims.allowed).toHaveLength(2);
    expect(p.claims.allowed.every((f) => f.confirmed === false)).toBe(true);
    expect(p.claims.forbidden[0].confirmed).toBe(false);
    expect(p.claims.forbidden[0].source).toEqual({ kind: "operator", url: null, page_id: null, quote: null });
    expect(p.business.contact.phone?.confirmed).toBe(false);
    expect(p.business.contact.phone?.source.kind).toBe("google_maps");
    expect(p.business.name).toBeNull();
    expect(EMPTY_PROFILE.claims.allowed).toEqual([]);
    expect((p as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });
});

describe("mergeDraft / diffPaths", () => {
  const cur = assembleProfile(
    [
      ef({ source: "operator", quote: null }),
      ef({ path: "business.name", value: "Acme", source: "operator", quote: null }),
      ef({ path: "voice.tone[]", value: "warm", source: "operator", quote: null }),
    ],
    pages,
  );
  const prod = (name: string, description: string) => ({
    name,
    description,
    price: null,
    category: null,
    featured: false,
    sort: 0,
    image_asset_ids: [],
    source: { kind: "website" as const },
    confirmed: false,
  });
  const draft: BrandProfileData = {
    ...assembleProfile(
      [
        ef({ value: "New tagline" }),
        ef({ path: "business.name", value: "Acme Co" }),
        ef({ path: "voice.tone[]", value: "bold" }),
        ef({ path: "voice.tone[]", value: "fun" }),
      ],
      pages,
    ),
    products: [prod("Widget", "new"), prod("Gadget", "g")],
  };
  const current: BrandProfileData = { ...cur, products: [{ ...prod("widget", "old"), id: "x1" }] };

  it("copies only the listed paths and matches products by name", () => {
    const m = mergeDraft(current, draft, ["business.tagline", "voice.tone[]", "products"]);
    expect(m.business.tagline?.value).toBe("New tagline");
    expect(m.business.name?.value).toBe("Acme");
    expect(m.voice.tone.map((t) => t.value)).toEqual(["bold", "fun"]);
    expect(m.products).toHaveLength(2);
    expect(m.products[0].description).toBe("new");
    expect(m.products[0].id).toBe("x1");
    expect(m.products[1].name).toBe("Gadget");
    expect(current.business.tagline?.value).toBe("Local since 2004");
  });

  it("diffPaths lists changed paths only", () => {
    const d = diffPaths(current, draft);
    expect(d.sort()).toEqual(["business.name", "business.tagline", "products", "voice.tone[]"].sort());
    expect(diffPaths(current, current)).toEqual([]);
  });
});
