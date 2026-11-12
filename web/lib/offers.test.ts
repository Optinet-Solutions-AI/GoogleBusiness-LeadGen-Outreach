import { describe, it, expect } from "vitest";
import { routeOffer, offersForSegment, offerForLead } from "@/lib/offers";

describe("routeOffer", () => {
  it("no website → build_website, segment no_website, qualifies", () => {
    const r = routeOffer({ has_website: false });
    expect(r.qualifies).toBe(true);
    expect(r.primary_offer).toBe("build_website");
    expect(r.secondary_offer).toBe("voice_agent");
    expect(r.segment).toBe("no_website");
  });
  it("old website → improve_website, segment old_website", () => {
    const r = routeOffer({ has_website: true, needs_improvement: true });
    expect(r.primary_offer).toBe("improve_website");
    expect(r.segment).toBe("old_website");
    expect(r.qualifies).toBe(true);
    expect(r.secondary_offer).toBe("voice_agent");
    expect(r.reason).toBeNull();
  });
  it("healthy website → KEPT (qualifies), no primary offer, segment has_website", () => {
    const r = routeOffer({ has_website: true, needs_improvement: false });
    expect(r.qualifies).toBe(true);
    expect(r.primary_offer).toBeNull();
    expect(r.secondary_offer).toBe("voice_agent");
    expect(r.segment).toBe("has_website");
  });
  it("real website not yet audited → has_website, no primary", () => {
    const r = routeOffer({ has_website: true, needs_improvement: null });
    expect(r.segment).toBe("has_website");
    expect(r.primary_offer).toBeNull();
    expect(r.qualifies).toBe(true);
  });
});

describe("offersForSegment", () => {
  it("no_website → build_website + voice_agent", () => {
    expect(offersForSegment("no_website")).toEqual({ primary_offer: "build_website", secondary_offer: "voice_agent" });
  });
  it("old_website → improve_website + voice_agent", () => {
    expect(offersForSegment("old_website")).toEqual({ primary_offer: "improve_website", secondary_offer: "voice_agent" });
  });
  it("has_website → null primary + voice_agent", () => {
    expect(offersForSegment("has_website")).toEqual({ primary_offer: null, secondary_offer: "voice_agent" });
  });
});

describe("liquidation routing", () => {
  it("routeOffer with a signal -> buy_inventory, no secondary", () => {
    expect(routeOffer({ has_website: false, needs_improvement: false, signal_type: "closure" })).toMatchObject({
      segment: "liquidation",
      primary_offer: "buy_inventory",
      secondary_offer: null,
    });
  });
  it("offersForSegment(liquidation)", () => {
    expect(offersForSegment("liquidation")).toEqual({ primary_offer: "buy_inventory", secondary_offer: null });
  });
});

describe("offerForLead (closure / exhibitor leads saved without an offer)", () => {
  it("uses the saved offer when there is one", () => {
    expect(offerForLead({ primary_offer: "buy_inventory", signal_type: "exhibitor" })).toBe("buy_inventory");
  });
  it("falls back to the lead type, never the website email", () => {
    expect(offerForLead({ primary_offer: null, signal_type: "exhibitor" })).toBe("booth_build");
    expect(offerForLead({ primary_offer: null, signal_type: "closure" })).toBe("buy_inventory");
    expect(offerForLead({ primary_offer: null, signal_type: "unspecified" })).toBe("buy_inventory");
  });
  it("normal leads keep a null offer", () => {
    expect(offerForLead({ primary_offer: null, signal_type: null })).toBeNull();
  });
});
