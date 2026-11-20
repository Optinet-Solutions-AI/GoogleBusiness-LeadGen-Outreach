/**
 * voice-test.test.ts — the lead details handed to the voice agent (browser test calls and real calls).
 *
 * Inputs:  lead-like objects, Voizo's scriptVariables
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { defaultVoiceOffer, greetingFor, missingScriptVariables, offerWords, VOICE_OFFERS, voiceVariables } from "./voice-test";

const LEAD = { business_name: "Zoom Drain", contact_owner_name: "Reilly Terrell, Russ Clarke", category: "Plumber", primary_offer: "build_website", signal_type: null, signal_meta: null };

describe("voiceVariables (Voizo's whitelist only)", () => {
  it("business, type and offer — no other keys, empty ones left out", () => {
    expect(voiceVariables(LEAD)).toEqual({ business: "Zoom Drain", category: "Plumber", offer: "a new website" });
  });

  it("conference leads get the show and stand", () => {
    expect(
      voiceVariables({ ...LEAD, business_name: "Galaxsys", category: "igaming", primary_offer: null, signal_type: "exhibitor", signal_meta: { event_name: "ICE Barcelona 2026", booth: "3C40" } }),
    ).toEqual({ business: "Galaxsys", category: "igaming", offer: "an exhibition stand, designed and built for your next show", event: "ICE Barcelona 2026", booth: "3C40" });
  });
});

describe("greetingFor", () => {
  it("the typed name wins, else the owner's first name, else none", () => {
    expect(greetingFor(LEAD)).toBe("Reilly");
    expect(greetingFor(LEAD, "Sam")).toBe("Sam");
    expect(greetingFor({ ...LEAD, contact_owner_name: null })).toBeNull();
  });
});

describe("missingScriptVariables", () => {
  it("lists the script's tokens this lead has no value for", () => {
    expect(missingScriptVariables(["business", "event", "playerName"], { business: "A" }, "Reilly")).toEqual(["event"]);
    expect(missingScriptVariables(["playerName"], {}, null)).toEqual(["playerName"]);
    expect(missingScriptVariables([], {}, null)).toEqual([]);
  });
  it("null = Voizo couldn't read the script: unknown, not complete", () => {
    expect(missingScriptVariables(null, {}, null)).toBeNull();
  });
});

describe("the offer picked in the test window", () => {
  it("starts on what Send email would pick: a good-website lead gets the AI receptionist, not nothing", () => {
    expect(defaultVoiceOffer({ ...LEAD, primary_offer: null, has_website: true, website_kind: "real", needs_improvement: false })).toBe("ai_receptionist");
    expect(defaultVoiceOffer({ ...LEAD, has_website: false })).toBe("website_build");
    expect(defaultVoiceOffer({ ...LEAD, signal_type: "exhibitor" })).toBe("booth_build");
  });
  it("the picked offer fills {{offer}}", () => {
    expect(voiceVariables({ ...LEAD, primary_offer: null }, "seo").offer).toBe("showing up higher on Google");
    expect(offerWords("website_redesign")).toBe("a website redesign");
  });
  it("lists the same offers as Send email, without 'write my own'", () => {
    expect(VOICE_OFFERS.map((o) => o.key)).toContain("booth_build");
    expect(VOICE_OFFERS.map((o) => o.key)).not.toContain("custom");
  });
});
