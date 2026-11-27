/**
 * stage-1-scrape.test.ts — pure helpers of stage 1 (row mapping, company dedupe).
 *
 * Inputs:  NormalizedLead fixtures (WARN-shaped and apify-shaped)
 * Outputs: assertions only
 * Used by: vitest
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: () => ({}) }));

import type { NormalizedLead } from "../services/types";
import { dedupeByCompany, dedupeByPlace, isWrongCountry, rowFromNormalized, tallyRows, scoreBudget, scoreRow, stillToSave, withoutMissing } from "./stage-1-scrape";

function lead(over: Partial<NormalizedLead> = {}): NormalizedLead {
  return {
    business_name: "Acme",
    phone: null,
    address: "x",
    category: "Closure",
    rating: null,
    review_count: null,
    has_website: false,
    website: null,
    website_kind: null,
    email: null,
    business_status: "OPERATIONAL",
    is_service_area_only: false,
    photos: [],
    reviews: [],
    place_id: "warn:1",
    latitude: null,
    longitude: null,
    raw: {},
    ...over,
  } as NormalizedLead;
}

const sig = (date: string, canon: string) => ({
  type: "closure" as const,
  date,
  source_url: "https://example.test",
  meta: { company_canonical: canon },
});

describe("rowFromNormalized", () => {
  it("maps the signal block to the four signal columns", () => {
    const row = rowFromNormalized(lead({ signal: sig("2026-10-01", "acme") }), {
      batchId: "b1",
      region: "us",
    });
    expect(row.signal_type).toBe("closure");
    expect(row.signal_date).toBe("2026-10-01");
    expect(row.signal_source_url).toBe("https://example.test");
    expect(row.signal_meta).toEqual({ company_canonical: "acme" });
    expect(row.batch_id).toBe("b1");
    expect(row.stage).toBe("scraped");
  });

  it("leaves signal columns null for a Google-shaped lead", () => {
    const row = rowFromNormalized(lead({ place_id: "ChIJ1", rating: 4.5 }), { batchId: "b", region: "us" });
    expect(row.signal_type).toBeNull();
    expect(row.signal_date).toBeNull();
    expect(row.signal_source_url).toBeNull();
    expect(row.signal_meta).toBeNull();
    expect(row.place_id).toBe("ChIJ1");
    expect(row.rating).toBe(4.5);
  });
});

describe("dedupeByCompany", () => {
  it("keeps the earliest notice per canonical company and drops the rest", () => {
    const a = lead({ place_id: "warn:a", signal: sig("2026-10-05", "Acme Co") });
    const b = lead({ place_id: "warn:b", signal: sig("2026-09-20", "acme co") });
    const c = lead({ place_id: "warn:c", signal: sig("2026-10-10", "Other") });
    const { keep, drop } = dedupeByCompany([a, b, c]);
    expect(keep.map((l) => l.place_id)).toEqual(["warn:b", "warn:c"]);
    expect(drop.map((l) => l.place_id)).toEqual(["warn:a"]);
  });

  it("passes apify-shaped leads through unchanged", () => {
    const leads = [lead({ place_id: "p1" }), lead({ place_id: "p2" }), lead({ place_id: "p1" })];
    const { keep, drop } = dedupeByCompany(leads);
    expect(keep).toEqual(leads);
    expect(drop).toEqual([]);
  });
});

describe("isWrongCountry", () => {
  it("rejects a place the scraper reports in another country", () => {
    expect(isWrongCountry({ country_code: "US" }, "es")).toBe(true);
  });
  it("keeps a matching or unknown country", () => {
    expect(isWrongCountry({ country_code: "ES" }, "es")).toBe(false);
    expect(isWrongCountry({ country_code: null }, "es")).toBe(false);
    expect(isWrongCountry({}, "es")).toBe(false);
    // no scraper country: the address decides
    expect(isWrongCountry({ address: "3 S Division St, Rome, GA 30165" }, "it")).toBe(true);
    expect(isWrongCountry({ address: "Via Roma 1, 00100 Roma RM, Italy" }, "it")).toBe(false);
  });
});

describe("tallyRows", () => {
  it("counts accepted and rejected and groups reasons without their detail", () => {
    expect(
      tallyRows([
        { qualified: true },
        { qualified: false, rejection_reason: "low_rating: 3.1★" },
        { qualified: false, rejection_reason: "low_rating: 2.0★" },
        { qualified: false, rejection_reason: null },
      ]),
    ).toEqual({ accepted: 1, rejected: 3, rejection_reasons: { low_rating: 2, unknown: 1 } });
  });
});

describe("dedupeByPlace (Any-niche batches)", () => {
  it("keeps one copy of a place found by two niche searches", () => {
    const a = lead({ business_name: "Joe's Locks", place_id: "p1" } as Partial<NormalizedLead>);
    const b = lead({ business_name: "Joe's Locks (key cutting)", place_id: "p1" } as Partial<NormalizedLead>);
    const c = lead({ business_name: "Other", place_id: "p2" } as Partial<NormalizedLead>);
    expect(dedupeByPlace([a, b, c])).toEqual([a, c]);
  });
  it("falls back to name + address when there is no place id", () => {
    const a = lead({ business_name: "Acme", address: "1 Main St", place_id: "" } as Partial<NormalizedLead>);
    const b = lead({ business_name: "ACME ", address: "1 main st", place_id: "" } as Partial<NormalizedLead>);
    expect(dedupeByPlace([a, b])).toHaveLength(1);
  });
});

describe("withoutMissing (a database without a newer migration still saves the batch)", () => {
  const row = { business_name: "A", website_review: { verdict: "good_website" }, ai_profile: { summary: "x" }, lead_score: 80, lead_score_detail: {}, lead_scored_at: "t" };
  it("076 missing drops only the score columns", () => {
    expect(withoutMissing('column "lead_score" of relation "leads" does not exist')(row)).toEqual({ business_name: "A", website_review: { verdict: "good_website" }, ai_profile: { summary: "x" } });
  });
  it("069 missing drops only the website check; 061 missing drops every extra", () => {
    expect(Object.keys(withoutMissing('column "website_review" does not exist')(row))).toEqual(["business_name", "ai_profile", "lead_score", "lead_score_detail", "lead_scored_at"]);
    expect(Object.keys(withoutMissing('column "ai_profile" does not exist')(row))).toEqual(["business_name"]);
  });
});

describe("lead score budget during scraping (final review)", () => {
  it("never more than AI Lookup's cap (the estimate counts min of the two), less what a resumed batch already scored", () => {
    expect(scoreBudget(50, 100, 0)).toBe(50);
    expect(scoreBudget(100, 30, 0)).toBe(30);
    expect(scoreBudget(100, 100, 40)).toBe(60);
    expect(scoreBudget(100, 100, 140)).toBe(0);
    expect(scoreBudget(0, 100, 0)).toBe(0);
  });
  it("past its time limit, scoring stops without calling OpenAI", async () => {
    const run = { left: 5, used: 0, usd: 0, until: Date.now() - 1 };
    const row: Record<string, unknown> = { business_name: "A" };
    await scoreRow(row, run);
    expect(run).toMatchObject({ left: 5, used: 0 });
    expect(row).toEqual({ business_name: "A" });
  });
});

describe("withoutMissing: link checks (080)", () => {
  it("080 missing drops only the link checks", () => {
    const row = { business_name: "A", lead_score: 80, link_checks: { contact_page: { state: "dead" } } };
    expect(withoutMissing('column "link_checks" of relation "leads" does not exist')(row)).toEqual({ business_name: "A", lead_score: 80 });
  });
});

describe("stillToSave (review fix: the final save never overwrites what the operator did meanwhile)", () => {
  it("only the rows whose early save failed are saved again", () => {
    const a = { business_name: "A" };
    const b = { business_name: "B" };
    const c = { business_name: "C" };
    const saved = new WeakSet<object>([a, c]);
    expect(stillToSave([a, b, c], saved)).toEqual([b]);
  });
});
