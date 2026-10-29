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
import { dedupeByCompany, rowFromNormalized } from "./stage-1-scrape";

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
