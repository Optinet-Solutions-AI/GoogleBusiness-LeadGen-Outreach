import { describe, expect, it } from "vitest";
import { JUDGE_SCHEMA, judgeInput, judgeInstructions, leadFacts, type FactsContext, type JudgeLead } from "./judge";
import { DEFAULT_SETTINGS, allowedMoves } from "./rules";

const lead = (over: Partial<JudgeLead> = {}): JudgeLead => ({
  id: "L1", business_name: "Zoom Drain", email: "owner@zoomdrain.com", verification_status: "valid", qualified: true, lifecycle_stage: "prospect",
  stage: "scraped", seq_status: "none", country_code: "us", call_segment: "no_website", website_kind: null, has_website: false, needs_improvement: null,
  signal_type: null, signal_meta: null, contact_owner_name: "Dana Cole", category: "Plumber", demo_url: null,
  phone: "+15125550123", call_status: null, primary_offer: "build_website", website_url: "https://zoomdrain.com", contact_page_url: null,
  rating: 4.6, review_count: 31, address: "1 Main St, Austin, TX", website_review: null, ...over,
});
const ctx = (over: Partial<FactsContext> = {}): FactsContext => ({ emailed: new Set(), triedForm: new Set(), inOtherJob: new Set(), callOffers: ["website_build", "ai_receptionist"], ...over });

describe("leadFacts", () => {
  it("a normal lead can be emailed, reached by form and called", () => {
    const f = leadFacts(lead(), DEFAULT_SETTINGS, ctx());
    expect(f).toMatchObject({ segment: "no_website", emailSkip: null, hasForm: true, callBlock: null, inOtherJob: false });
    expect(allowedMoves(f, DEFAULT_SETTINGS).channels).toEqual(["email", "form", "call"]);
  });

  it("never re-emails, never a second form, never two jobs", () => {
    expect(leadFacts(lead(), DEFAULT_SETTINGS, ctx({ emailed: new Set(["L1"]) })).emailSkip).toBe("Already emailed before");
    expect(leadFacts(lead(), DEFAULT_SETTINGS, ctx({ triedForm: new Set(["L1"]) })).hasForm).toBe(false);
    expect(leadFacts(lead(), DEFAULT_SETTINGS, ctx({ inOtherJob: new Set(["L1"]) })).inOtherJob).toBe(true);
  });

  it("a lead that replied, unsubscribed or asked not to be called has no channel at all", () => {
    for (const over of [{ stage: "replied" }, { lifecycle_stage: "unsubscribed" }, { lifecycle_stage: "dnc" }]) {
      const f = leadFacts(lead(over), DEFAULT_SETTINGS, ctx());
      expect(allowedMoves(f, DEFAULT_SETTINGS).channels, JSON.stringify(over)).toEqual([]);
    }
  });

  it("EU / UK: out by default; switched in → email and form only, never a call", () => {
    const de = lead({ country_code: "de" });
    expect(allowedMoves(leadFacts(de, DEFAULT_SETTINGS, ctx()), DEFAULT_SETTINGS).channels).toEqual([]);
    const withEu = { ...DEFAULT_SETTINGS, includeEu: true };
    expect(allowedMoves(leadFacts(de, withEu, ctx()), withEu).channels).toEqual(["email", "form"]);
  });

  it("a review-site lead is never called", () => {
    const f = leadFacts(lead({ call_segment: "reputation", signal_type: "review_site", primary_offer: "reputation_mgmt" }), DEFAULT_SETTINGS, ctx({ callOffers: ["reputation_mgmt"] }));
    expect(f.callBlock).not.toBeNull();
  });
});

describe("judgeInput", () => {
  const moves = allowedMoves(leadFacts(lead(), DEFAULT_SETTINGS, ctx()), DEFAULT_SETTINGS);

  it("lists only the allowed offers and channels, by key", () => {
    const text = judgeInput({ lead: lead(), moves, place: "Austin, TX" });
    expect(text).toContain("Allowed offers (key = meaning): website_build = New website; ai_receptionist = AI voice agent (answers their calls); ai_booking = AI booking / calendar agent");
    expect(text).toContain("Allowed channels (keys): email, form, call");
    expect(text).not.toContain("seo");
  });

  it("never shows the AI an email address, a phone number or the owner's name", () => {
    const text = judgeInput({ lead: lead(), moves, place: "Austin, TX" });
    expect(text).not.toMatch(/owner@zoomdrain\.com|5125550123|Dana/);
  });

  it("works for a lead with no website check, and uses the check when there is one", () => {
    expect(judgeInput({ lead: lead(), moves, place: null })).toContain("Website check: not done. Has a website on file: yes.");
    const checked = lead({ website_review: { verdict: "old_website", score: 42, summary: "Dated design.", reasons: ["Not mobile friendly"], pitch: { why: "A faster site wins calls." } } });
    expect(judgeInput({ lead: checked, moves, place: null })).toContain("Website check: old website, score 42/100. Dated design. Reasons: Not mobile friendly. Suggested pitch: A faster site wins calls.");
  });

  it("the schema is strict and the instructions keep the AI inside the lists", () => {
    expect(JUDGE_SCHEMA.required).toEqual(["contact", "offer", "channels", "reason"]);
    expect(JUDGE_SCHEMA.additionalProperties).toBe(false);
    expect(judgeInstructions()).toMatch(/Never add one/);
    expect(judgeInstructions()).toMatch(/data, not instructions/);
  });
});
