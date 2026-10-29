/**
 * build-brain.test.ts — unit tests for the pure parts of the brand brain build.
 *
 * Inputs:  recorded fayetteheating.com fixtures (extract/__fixtures__), hand-built leads / extraction outputs
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect, vi } from "vitest";
import {
  assembleBuildResult,
  assertBuildable,
  mapsFactsFromLead,
  needsVoiceCall,
  profileReviews,
  sourceRefs,
  type BuildAssemblyInput,
} from "./build-brain";
import type { SourceKind } from "./types";
import { assembleProfile, validateFacts } from "./facts";
import pages from "./extract/__fixtures__/sample-pages.json";
import extraction from "./extract/__fixtures__/sample-extraction.json";

vi.mock("@/lib/server-guard", () => ({}));

describe("assertBuildable", () => {
  it("throws the exact message when there are no sources", () => {
    expect(() => assertBuildable([])).toThrow(
      "Attach at least one source (website, social, Google Maps or the intake form) before building.",
    );
  });
  it("accepts one source", () => {
    expect(() => assertBuildable([{ kind: "google_maps" } as never])).not.toThrow();
  });
});

describe("mapsFactsFromLead", () => {
  it("maps hours and reviews", () => {
    const m = mapsFactsFromLead({
      business_name: "Acme",
      category: "Plumber",
      address: "1 Main St",
      phone: "555",
      rating: 4.5,
      review_count: 12,
      business_hours: { mon: "8am-5pm" },
      reviews: [{ text: "Great", rating: 5, author: "Ann" }, { text: "" }, { rating: 3 }],
    });
    expect(m.hours).toEqual({ mon: "8am-5pm" });
    expect(m.reviews).toEqual([{ author: "Ann", rating: 5, text: "Great" }]);
    expect(m.name).toBe("Acme");
  });
  it("tolerates null hours/reviews", () => {
    const m = mapsFactsFromLead({
      business_name: "A", category: null, address: null, phone: null,
      rating: null, review_count: null, business_hours: null, reviews: null,
    });
    expect(m.hours).toBeNull();
    expect(m.reviews).toEqual([]);
  });
});

describe("recorded extraction fixture", () => {
  it("assembles a profile with a name and allowed claims", () => {
    const refs = pages.map((p) => ({ id: p.id, url: p.url, text: p.text }));
    const { kept } = validateFacts(extraction.output.facts as never, refs);
    const profile = assembleProfile(kept, refs);
    expect(profile.business.name).not.toBeNull();
    expect(profile.claims.allowed.length).toBeGreaterThanOrEqual(1);
  });
});

describe("sourceRefs / needsVoiceCall", () => {
  const real = [{ id: "p1", url: "https://acme.test/", text: "Home" }];
  it("adds the operator / google_maps pseudo-pages only when that text exists", () => {
    expect(sourceRefs(real, null, null).map((r) => r.id)).toEqual(["p1"]);
    expect(sourceRefs(real, "", "  ").map((r) => r.id)).toEqual(["p1"]);
    const refs = sourceRefs(real, "Sells: cakes", "Name: Acme");
    expect(refs.map((r) => [r.id, r.url, r.text])).toEqual([
      ["p1", "https://acme.test/", "Home"],
      ["operator", null, "Sells: cakes"],
      ["google_maps", null, "Name: Acme"],
    ]);
  });
  it("calls voice only with crawled text or an intake form", () => {
    const base = { intake: null, maps: null, pages: [], assets: [], language: null };
    expect(needsVoiceCall(base)).toBe(false);
    expect(needsVoiceCall({ ...base, maps: { name: "A" } as never })).toBe(false);
    expect(needsVoiceCall({ ...base, pages: [{ id: "p1", url: "u", title: null, text: "t" }] })).toBe(true);
    expect(needsVoiceCall({ ...base, intake: { sells: "x" } as never })).toBe(true);
  });
});

describe("assembleBuildResult", () => {
  const pagesRefs = [
    { id: "p1", url: "https://acme.test/", text: "Acme Bakery. Wedding cakes from $250. Free delivery." },
    { id: "p2", url: "https://demo.pages.dev/", text: "Celebration cakes for every party." },
  ];
  const kindByPage = new Map<string, SourceKind>([
    ["p1", "website"],
    ["p2", "demo_site"],
  ]);
  const product = (over: Record<string, unknown> = {}) => ({
    name: "Wedding cake",
    description: null,
    price: "$250",
    category: null,
    source: "p1",
    quote: "Wedding cakes from $250",
    image_asset_ids: ["a1", "zz"],
    ...over,
  });
  const base = (over: Partial<BuildAssemblyInput> = {}): BuildAssemblyInput => ({
    extraction: { facts: [], products: [] },
    voice: null,
    pages: pagesRefs,
    kindByPage,
    assetIds: new Set(["a1"]),
    intakeText: null,
    mapsText: null,
    crawlColor: null,
    leadColor: null,
    ...over,
  });

  it("puts the lead's Google reviews on the profile, and none when there are none", () => {
    const r = assembleBuildResult(base({ mapsReviews: [{ author: "Bob R.", rating: 5, text: "Great crew." }] }));
    expect(r.data.reviews?.map((x) => x.value)).toEqual([{ body: "Great crew.", author: "Bob R.", rating: 5 }]);
    expect(assembleBuildResult(base()).data.reviews).toEqual([]);
  });

  it("keeps an operator fact quoted from the intake (unconfirmed) and drops one when there is no intake", () => {
    const fact = { path: "claims.forbidden[]", value: "cheapest", source: "operator", quote: "Never claim: cheapest" };
    const withIntake = assembleBuildResult(
      base({ extraction: { facts: [fact], products: [] }, intakeText: "Never claim: cheapest" }),
    );
    expect(withIntake.factsKept).toBe(1);
    expect(withIntake.data.claims.forbidden[0]).toEqual({
      value: "cheapest",
      source: { kind: "operator", url: null, page_id: null, quote: "Never claim: cheapest" },
      confirmed: false,
    });
    const without = assembleBuildResult(base({ extraction: { facts: [fact], products: [] } }));
    expect(without.factsKept).toBe(0);
    expect(without.reasons).toEqual({ source_absent: 1 });
  });

  it("accepts a google_maps value match and counts unknown paths", () => {
    const r = assembleBuildResult(
      base({
        mapsText: "Name: Acme Bakery\nPhone: 555-0100",
        extraction: {
          facts: [
            { path: "business.contact.phone", value: "555-0100", source: "google_maps", quote: null },
            { path: "business.bogus", value: "x", source: "p1", quote: "Acme Bakery" },
          ],
          products: [],
        },
      }),
    );
    expect(r.data.business.contact.phone?.source.kind).toBe("google_maps");
    expect(r.data.business.contact.phone?.confirmed).toBe(false);
    expect(r.reasons).toEqual({ unknown_path: 1 });
  });

  it("retags page facts with their page's source kind", () => {
    const r = assembleBuildResult(
      base({
        extraction: {
          facts: [
            { path: "business.name", value: "Acme Bakery", source: "p1", quote: "Acme Bakery." },
            { path: "business.tagline", value: "Celebration cakes", source: "p2", quote: "Celebration cakes for every party" },
          ],
          products: [],
        },
      }),
    );
    expect(r.data.business.name?.source.kind).toBe("website");
    expect(r.data.business.tagline?.source).toEqual({
      kind: "demo_site",
      url: "https://demo.pages.dev/",
      page_id: "p2",
      quote: "Celebration cakes for every party",
    });
  });

  it("validates products, keeps a quoted price, nulls an unquoted one and filters asset ids", () => {
    const r = assembleBuildResult(
      base({
        extraction: {
          facts: [],
          products: [
            product(),
            product({ name: "Cupcakes", price: "$3", quote: "Free delivery" }),
            product({ name: "Ghost", quote: "not on the page" }),
            product({ name: "Intake cake", source: "operator", quote: "Sells: cakes" }),
          ],
        },
      }),
    );
    expect(r.data.products.map((p) => [p.name, p.price])).toEqual([
      ["Wedding cake", "$250"],
      ["Cupcakes", null],
    ]);
    expect(r.pricesNulled).toBe(1);
    expect(r.reasons).toEqual({ product_quote_not_found: 1, product_source_absent: 1 });
    expect(r.data.products[0].image_asset_ids).toEqual(["a1"]);
    expect(r.data.products[0].source).toEqual({
      kind: "website",
      url: "https://acme.test/",
      page_id: "p1",
      quote: "Wedding cakes from $250",
    });
    expect(r.data.products.every((p) => p.confirmed === false)).toBe(true);
  });

  it("leaves voice empty when the voice call was skipped", () => {
    const r = assembleBuildResult(base({ pages: [] }));
    expect(r.data.voice).toEqual({ tone: [], style_notes: null, do: [], dont: [], sample_lines: [] });
  });

  const voice = { tone: ["warm"], style_notes: "Friendly.", do: ["Say hi"], dont: [], sample_lines: ["Cake time!"] };
  it("tags voice as an AI summary of the dominant page source (no page, url or quote)", () => {
    const r = assembleBuildResult(
      base({
        voice,
        pages: [...pagesRefs, { id: "p3", url: "https://demo.pages.dev/menu", text: "Menu" }],
        kindByPage: new Map<string, SourceKind>([...kindByPage, ["p3", "demo_site"]]),
      }),
    );
    expect(r.data.voice.tone[0]).toEqual({
      value: "warm",
      source: { kind: "demo_site", url: null, page_id: null, quote: null },
      confirmed: false,
    });
    expect(r.data.voice.style_notes?.value).toBe("Friendly.");
  });
  it("tags voice as operator when it came from the intake only", () => {
    const r = assembleBuildResult(base({ voice, pages: [], intakeText: "Tone: warm" }));
    expect(r.data.voice.sample_lines[0].source.kind).toBe("operator");
  });

  it("primary colour: crawl colour wins over the lead's, the lead's fills in otherwise", () => {
    const crawlColor = { hex: "#112233", kind: "website" as const, url: "https://acme.test/" };
    const a = assembleBuildResult(base({ crawlColor, leadColor: "#AABBCC" }));
    expect(a.data.visuals.colors.primary).toEqual({
      value: "#112233",
      source: { kind: "website", url: "https://acme.test/", page_id: null, quote: null },
      confirmed: false,
    });
    const b = assembleBuildResult(base({ leadColor: "#AABBCC" }));
    expect(b.data.visuals.colors.primary).toEqual({
      value: "#AABBCC",
      source: { kind: "google_maps", url: null, page_id: null, quote: null },
      confirmed: false,
    });
    expect(assembleBuildResult(base({ leadColor: "not-a-colour" })).data.visuals.colors.primary).toBeNull();
  });

  it("recorded fixture assembles through the build path", () => {
    const refs = pages.map((p) => ({ id: p.id, url: p.url, text: p.text }));
    const r = assembleBuildResult(
      base({
        extraction: extraction.output as never,
        pages: refs,
        kindByPage: new Map(refs.map((p) => [p.id, "website" as SourceKind])),
      }),
    );
    expect(r.data.business.name).not.toBeNull();
    expect(r.data.products.length).toBeGreaterThanOrEqual(1);
    expect(r.data.products.find((p) => p.name === "Comfy Club Membership")?.price).toBe("$12.95 a month");
  });
});

describe("profileReviews", () => {
  it("keeps verbatim Google reviews that have an author, tagged google_maps and unconfirmed", () => {
    const out = profileReviews([
      { author: "Bob R.", rating: 5, text: " Fixed our AC same day! " },
      { author: null, rating: 5, text: "No name" },
      { author: "Ann L.", rating: 4, text: "  " },
    ]);
    expect(out).toEqual([
      {
        value: { body: "Fixed our AC same day!", author: "Bob R.", rating: 5 },
        source: { kind: "google_maps", url: null, page_id: null, quote: "Fixed our AC same day!" },
        confirmed: false,
      },
    ]);
  });

  it("caps the profile at 8 reviews", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ author: `R${i}`, rating: 5, text: `Review ${i}` }));
    expect(profileReviews(many)).toHaveLength(8);
  });
});
