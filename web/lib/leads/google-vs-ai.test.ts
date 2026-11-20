/**
 * google-vs-ai.test.ts — the discrepancy box: where Google's details and AI Lookup's findings disagree.
 *
 * Inputs:  lead-like Google details + AI Lookup results
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { googleVsAi, websiteVerifyPatch } from "./google-vs-ai";

const AI = { website: null as string | null, phones: [] as string[], address: null as string | null };
const G = { website_url: null as string | null, website_kind: "none" as string | null, phone: "(512) 555-0100", address: "85 N Sage Ave, Mobile, AL 36607" };

describe("googleVsAi", () => {
  it("Google had no website, AI found one → check it", () => {
    const d = googleVsAi(G, { ...AI, website: "https://renuka.in" });
    expect(d).toEqual([{ field: "website", google: null, ai: "https://renuka.in", note: "Google has no website for them. AI found this one — open it and press Verify if it's theirs." }]);
  });
  it("different website from Google's → check", () => {
    const d = googleVsAi({ ...G, website_url: "https://old.com", website_kind: "real" }, { ...AI, website: "https://www.new.com/" });
    expect(d[0]).toMatchObject({ field: "website", google: "https://old.com", ai: "https://www.new.com/" });
  });
  it("same website (www / slash / http differences) → no box", () => {
    expect(googleVsAi({ ...G, website_url: "http://new.com", website_kind: "real" }, { ...AI, website: "https://www.new.com/" })).toEqual([]);
  });
  it("a different phone → check; the same number in another format → nothing", () => {
    expect(googleVsAi(G, { ...AI, phones: ["+1 512 555 0199"] })[0]).toMatchObject({ field: "phone", google: "(512) 555-0100", ai: "+1 512 555 0199" });
    expect(googleVsAi(G, { ...AI, phones: ["+15125550100", "+1 512 555 0199"] })).toEqual([]);
  });
  it("a different street number → address check; same address written differently → nothing", () => {
    expect(googleVsAi(G, { ...AI, address: "12 Dauphin St, Mobile, AL" })[0]).toMatchObject({ field: "address" });
    expect(googleVsAi(G, { ...AI, address: "85 North Sage Avenue, Mobile AL 36607" })).toEqual([]);
  });
  it("AI found nothing for a field → no box (AI often misses)", () => {
    expect(googleVsAi({ ...G, website_url: "https://a.com", website_kind: "real" }, AI)).toEqual([]);
  });
});

describe("websiteVerifyPatch", () => {
  it("a normal lead: saves the website and moves it off the 'no website' pitch", () => {
    expect(websiteVerifyPatch({ signal_type: null }, "https://renuka.in")).toEqual({
      website_url: "https://renuka.in",
      website_kind: "real",
      has_website: true,
      call_segment: "has_website",
      primary_offer: null,
      secondary_offer: "voice_agent",
    });
  });
  it("a conference / review-site lead keeps its own offer", () => {
    expect(websiteVerifyPatch({ signal_type: "exhibitor" }, "https://x.com")).toEqual({ website_url: "https://x.com", website_kind: "real", has_website: true });
  });
});

describe("googleVsAi ignores websites that aren't real (QA 20 Nov 2026)", () => {
  it("a facebook homepage or business.site from AI → no website line", () => {
    expect(googleVsAi(G, { ...AI, website: "https://www.facebook.com" })).toEqual([]);
    expect(googleVsAi(G, { ...AI, website: "https://renuka.business.site" })).toEqual([]);
  });
});
