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
  it("drops missing_quote for a page source", () => {
    const r = validateFacts([ef({ quote: null }), ef({ quote: "  " })], pages);
    expect(r.dropped.map((d) => d.reason)).toEqual(["missing_quote", "missing_quote"]);
  });
  it("keeps operator and google_maps facts without a quote", () => {
    const a = ef({ source: "operator", quote: null });
    const b = ef({ source: "google_maps", quote: null });
    const r = validateFacts([a, b], pages);
    expect(r.kept).toEqual([a, b]);
  });
});

describe("assembleProfile", () => {
  it("sets scalar and list paths and marks operator facts confirmed", () => {
    const p = assembleProfile(
      [
        ef(),
        ef({ path: "claims.allowed[]", value: "free quotes" }),
        ef({ path: "claims.allowed[]", value: "local" }),
        ef({ path: "claims.forbidden[]", value: "cheapest", source: "operator", quote: null }),
        ef({ path: "business.contact.phone", value: "555", source: "google_maps", quote: null }),
        ef({ path: "bogus.path", value: 1 }),
      ],
      pages,
    );
    expect(p.business.tagline).toEqual({
      value: "Local since 2004",
      source: { kind: "website", url: "https://acme.test/about", page_id: "p1", quote: "free quotes" },
      confirmed: false,
    });
    expect(p.claims.allowed).toHaveLength(2);
    expect(p.claims.forbidden[0].confirmed).toBe(true);
    expect(p.claims.forbidden[0].source.kind).toBe("operator");
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
