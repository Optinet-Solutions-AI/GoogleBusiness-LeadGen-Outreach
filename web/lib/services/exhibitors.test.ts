import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("../logger", () => ({ getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { dedupeExhibitors, eventFromDiscovered, eventFromUrl, normalizeExhibitor, type ExhibitorEvent } from "./exhibitors";

const ev: ExhibitorEvent = { name: "SiGMA Europe 2026", url: "https://sigma.world", pages: ["https://sigma.world/floor-plan"], city: "Valletta", country: "mt", start_date: "2026-11-02", end_date: "2026-11-05" };

describe("normalizeExhibitor", () => {
  it("makes a signal lead with the event and booth in meta", () => {
    const l = normalizeExhibitor({ name: " Acme Gaming ", website: "https://acme.example", booth: "A12", country: "MT", description: "slots" }, ev, { category: "igaming", year: 2026, source_url: "https://x.expofp.com/" });
    expect(l).toMatchObject({ business_name: "Acme Gaming", has_website: true, website_kind: "real", country_code: "mt", category: "igaming", phone: null });
    expect(l.signal).toMatchObject({ type: "exhibitor", date: "2026-11-05", source_url: "https://x.expofp.com/", meta: { event_name: "SiGMA Europe 2026", booth: "A12", event_city: "Valletta", year: 2026, description: "slots" } });
    const noSite = normalizeExhibitor({ name: "Beta", website: null, booth: null, country: null }, ev, { category: "igaming", year: 2026, source_url: "u" });
    expect(noSite.has_website).toBe(false);
    expect(noSite.country_code).toBeNull();
  });
});

describe("dedupeExhibitors", () => {
  it("keeps the first of a company seen at several shows, ignoring Ltd/GmbH noise", () => {
    const mk = (n: string) => normalizeExhibitor({ name: n, website: null, booth: null, country: null }, ev, { category: "igaming", year: 2026, source_url: "u" });
    const { keep, dropped } = dedupeExhibitors([mk("Acme Ltd"), mk("ACME"), mk("Acme, Ltd."), mk("Beta GmbH"), mk("")]);
    expect(keep.map((l) => l.business_name)).toEqual(["Acme Ltd", "Beta GmbH"]);
    expect(dropped).toBe(3);
  });
});

describe("events", () => {
  it("builds an event from a pasted link and from a discovered one", () => {
    expect(eventFromUrl("https://www.ice-london.com/exhibitors")).toMatchObject({ name: "ice-london", pages: ["https://www.ice-london.com/exhibitors"] });
    expect(eventFromDiscovered({ name: "X", website: "https://x.com", exhibitors_url: "https://x.com/ex", floor_plan_url: null, city: null, country: "de", start_date: null, end_date: null })).toMatchObject({ url: "https://x.com", pages: ["https://x.com/ex", "https://x.com"] });
    expect(eventFromDiscovered({ name: "Y", website: null, exhibitors_url: null, floor_plan_url: null, city: null, country: null, start_date: null, end_date: null })).toBeNull();
  });
});
