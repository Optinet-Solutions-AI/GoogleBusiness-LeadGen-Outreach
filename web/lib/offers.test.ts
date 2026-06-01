import { describe, it, expect } from "vitest";
import { routeOffer } from "@/lib/offers";

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
