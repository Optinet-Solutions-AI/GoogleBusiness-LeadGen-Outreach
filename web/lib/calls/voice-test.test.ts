/**
 * voice-test.test.ts — the lead details handed to the voice agent (browser test calls and real calls).
 *
 * Inputs:  lead-like objects, Voizo's scriptVariables
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { defaultVoiceOffer, greetingFor, isNormalCallEnd, micErrorText, testCallTranscript, missingScriptVariables, offerWords, pickScript, VOICE_OFFERS, voiceErrorText, voiceVariables } from "./voice-test";

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

describe("details for the other scripts", () => {
  it("city from the batch (before the comma), site + rating + reviews for review-site leads", () => {
    expect(
      voiceVariables({ ...LEAD, signal_type: "review_site", signal_meta: { platform: "trustpilot", rating: 2.1, review_count: 85 } }, null, "Austin, TX"),
    ).toMatchObject({ city: "Austin", site: "Trustpilot", rating: "2.1 stars", reviews: "85 reviews" });
  });
  it("a region code (eu, TX, US) is not a city", () => {
    for (const c of ["eu", "TX", "US"]) expect(voiceVariables(LEAD, null, c).city).toBeUndefined();
  });
});

describe("pickScript", () => {
  const scripts = [
    { campaignId: "c-web", offerKey: "website_build", name: "Lead Gen API — website_build", scriptVariables: ["business"], canDial: true },
    { campaignId: "c-seo", offerKey: "seo", name: "Lead Gen API — seo", scriptVariables: ["city"], canDial: false },
    { campaignId: "c-x", offerKey: null, name: "odd", scriptVariables: [], canDial: false },
  ];
  it("the script for the picked offer", () => {
    expect(pickScript(scripts, "seo")?.campaignId).toBe("c-seo");
  });
  it("no script for that offer (or one not named to convention) → none", () => {
    expect(pickScript(scripts, "booth_build")).toBeNull();
    expect(pickScript(scripts, null)).toBeNull();
  });
});

describe("browser call errors", () => {
  it("the agent hanging up is a normal end, not an error", () => {
    expect(isNormalCallEnd({ type: "daily-error", error: { msg: "Meeting has ended" } })).toBe(true);
    expect(isNormalCallEnd({ errorMsg: "Meeting ended due to ejection: Meeting has ended" })).toBe(true);
    expect(isNormalCallEnd({ error: { message: "Permission denied" } })).toBe(false);
  });
  it("real errors show their own words, wherever Vapi put them", () => {
    expect(voiceErrorText({ error: { message: "Permission denied" } })).toBe("Permission denied");
    expect(voiceErrorText({ type: "daily-error", error: { msg: "Network lost" } })).toBe("Network lost");
    expect(voiceErrorText({ error: { error: { message: "Bad key" } } })).toBe("Bad key");
    expect(voiceErrorText({})).toBe("The test call stopped with an error.");
  });
});

describe("testCallTranscript", () => {
  it("one line per turn, the tester shown as Tester", () => {
    expect(testCallTranscript([{ role: "Agent", text: "Hey, Lucas here." }, { role: "You", text: "Hi" }])).toBe("Agent: Hey, Lucas here.\nTester: Hi");
    expect(testCallTranscript([])).toBe("");
  });
});

describe("micErrorText (QA D03: mic blocked)", () => {
  it("blocked microphone → how to allow it", () => {
    expect(micErrorText({ name: "NotAllowedError" })).toMatch(/microphone is blocked/i);
    expect(micErrorText({ name: "SecurityError" })).toMatch(/microphone is blocked/i);
  });
  it("no microphone → plain message", () => {
    expect(micErrorText({ name: "NotFoundError" })).toMatch(/no microphone/i);
  });
  it("anything else → generic", () => {
    expect(micErrorText(new Error("x"))).toMatch(/couldn.t use the microphone/i);
  });
});
