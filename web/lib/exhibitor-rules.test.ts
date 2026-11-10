import { describe, it, expect } from "vitest";
import { deriveSegment, resolveSegment } from "./segment";
import { offersForSegment, routeOffer, OFFER_LABEL } from "./offers";
import { buildSurfaceFor } from "./lead-offer";
import { qualifies } from "./filters";
import { signalSummary, signalTypeLabel } from "./lead-signal";
import { BatchSettingsSchema } from "./batch-settings";
import { estimate } from "./pricing";

describe("exhibitor leads", () => {
  it("segment exhibitor → booth_build, never a website", () => {
    expect(deriveSegment({ has_website: true, signal_type: "exhibitor" })).toBe("exhibitor");
    expect(resolveSegment({ website_kind: "real", signal_type: "exhibitor" })).toBe("exhibitor");
    expect(offersForSegment("exhibitor")).toEqual({ primary_offer: "booth_build", secondary_offer: null });
    expect(routeOffer({ has_website: true, needs_improvement: true, signal_type: "exhibitor" })).toMatchObject({ segment: "exhibitor", primary_offer: "booth_build" });
    expect(buildSurfaceFor({ segment: "exhibitor", buildable: true })).toBe("off_niche");
    expect(OFFER_LABEL.booth_build).toBe("Build their next booth");
    // closures still go to liquidation
    expect(deriveSegment({ has_website: false, signal_type: "closure" })).toBe("liquidation");
  });

  it("qualifies even when the show was months ago (no staleness gate for exhibitors)", () => {
    const old = { business_name: "Acme", has_website: true, rating: null, review_count: null, phone: null, category: "igaming", business_status: null, signal_type: "exhibitor", signal_date: "2026-02-01", signal_meta: null };
    expect(qualifies(old, null, { now: new Date("2026-11-05") }).passes).toBe(true);
    const closure = { ...old, signal_type: "closure" };
    expect(qualifies(closure, null, { now: new Date("2026-11-05") })).toMatchObject({ passes: false, reason: "stale_signal" });
  });

  it("labels and summary", () => {
    expect(signalTypeLabel("exhibitor")).toBe("Exhibitor");
    expect(signalSummary({ signal_type: "exhibitor", signal_date: "2026-11-05T00:00:00Z", signal_meta: { event_name: "SiGMA Europe 2026", booth: "A12", event_city: "Valletta" } })).toBe("Exhibitor · SiGMA Europe 2026 · booth A12 · Valletta · 2026-11-05");
  });

  it("batch settings accept event links and a year", () => {
    expect(BatchSettingsSchema.parse({ event_urls: ["https://sigma.world/floor-plan"], year: 2026 })).toMatchObject({ event_urls: ["https://sigma.world/floor-plan"], year: 2026, window_days: 90 });
    expect(BatchSettingsSchema.parse({})).toMatchObject({ event_urls: [], year: 2026 });
    expect(() => BatchSettingsSchema.parse({ event_urls: ["not a url"] })).toThrow();
  });

  it("estimate: free lists + discovery + contact finder, nothing built", () => {
    const est = estimate("exhibitors", 200);
    expect(est.effective_limit).toBe(200);
    expect(est.scrape.lines.map((l) => l.item)).toEqual(["Conference discovery (OpenAI web search)", "Exhibitor lists / floor plans (free)", "AI research: contacts + owner (OpenAI web search)"]);
    expect(est.build.lines).toHaveLength(0);
    // AI research first on up to 100 exhibitors (the per-batch limit) at 2¢ + 8¢ discovery.
    expect(est.scrape.lines[2].qty).toBe(100);
    expect(est.total_usd).toBeCloseTo(2.08, 4);
    expect(estimate("exhibitors", 200, { aiCap: 0 }).scrape.lines).toHaveLength(2);
  });
});
