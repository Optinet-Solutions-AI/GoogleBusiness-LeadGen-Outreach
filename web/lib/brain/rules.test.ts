import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  allowedMoves,
  allowedOffers,
  canSpend,
  cleanSettings,
  defaultDecision,
  jobEstimate,
  validateDecision,
  type JobSettings,
  type LeadFacts,
} from "./rules";

const facts = (over: Partial<LeadFacts> = {}): LeadFacts => ({
  id: "L1", segment: "no_website", emailSkip: null, hasForm: true, callBlock: null, inOtherJob: false,
  callOffers: ["website_build", "ai_receptionist"], ...over,
});
const S: JobSettings = DEFAULT_SETTINGS;

describe("allowedOffers", () => {
  it("lists what each kind of lead may be offered", () => {
    expect(allowedOffers("no_website")).toEqual(["website_build", "ai_receptionist", "ai_booking"]);
    expect(allowedOffers("old_website")).toEqual(["website_redesign", "ai_receptionist", "ai_booking", "seo"]);
    expect(allowedOffers("has_website")).toEqual(["ai_receptionist", "ai_booking", "seo"]);
    expect(allowedOffers("liquidation")).toEqual(["buy_inventory"]);
    expect(allowedOffers("exhibitor")).toEqual(["booth_build"]);
    expect(allowedOffers("reputation")).toEqual(["reputation_mgmt"]);
    expect(allowedOffers(null)).toEqual([]);
    expect(allowedOffers("something_new")).toEqual([]);
  });

  it("never offers a website to a business with a good one", () => {
    expect(allowedOffers("has_website").some((o) => o.startsWith("website_"))).toBe(false);
  });
});

describe("allowedMoves", () => {
  it("gives every channel the lead has and the job switched on", () => {
    expect(allowedMoves(facts(), S)).toEqual({ offers: ["website_build", "ai_receptionist", "ai_booking"], channels: ["email", "form", "call"], skip: null });
  });

  it("drops a channel the lead can't use", () => {
    expect(allowedMoves(facts({ emailSkip: "No email address" }), S).channels).toEqual(["form", "call"]);
    expect(allowedMoves(facts({ hasForm: false }), S).channels).toEqual(["email", "call"]);
    expect(allowedMoves(facts({ callBlock: "No phone number on this lead." }), S).channels).toEqual(["email", "form"]);
    // Voizo has no script for any offer this lead may get: no call.
    expect(allowedMoves(facts({ callOffers: ["seo"] }), S).channels).toEqual(["email", "form"]);
  });

  it("never allows a channel the job switched off", () => {
    const off = { ...S, channels: { email: true, form: false, call: false } };
    expect(allowedMoves(facts(), off).channels).toEqual(["email"]);
  });

  it("says why a lead is skipped", () => {
    expect(allowedMoves(facts({ inOtherJob: true }), S).skip).toBe("Already in another brain job");
    expect(allowedMoves(facts({ segment: null }), S).skip).toBe("No offer fits this lead");
    const none = allowedMoves(facts({ emailSkip: "No email address", hasForm: false, callBlock: "No phone number on this lead." }), S);
    expect(none.channels).toEqual([]);
    expect(none.skip).toBe("No way to reach this lead (No email address; no contact form on their site; No phone number on this lead.)");
  });
});

describe("validateDecision", () => {
  const m = allowedMoves(facts(), S);

  it("keeps an answer that stays inside the lists", () => {
    expect(validateDecision({ contact: true, offer: "ai_receptionist", channels: ["email", "call"], reason: " Busy plumber, no site. " }, m, facts())).toEqual({
      contact: true, offer: "ai_receptionist", channels: ["email", "call"], reason: "Busy plumber, no site.", source: "ai",
    });
  });

  it("keeps a skip with its reason", () => {
    expect(validateDecision({ contact: false, offer: "", channels: [], reason: "Permanently closed on Google." }, m, facts())).toEqual({
      contact: false, offer: null, channels: [], reason: "Permanently closed on Google.", source: "ai",
    });
  });

  it("falls back to the standard rule when the answer leaves the lists", () => {
    const dflt = defaultDecision(m, facts());
    expect(dflt).toMatchObject({ contact: true, offer: "website_build", channels: ["email", "form", "call"], source: "default" });
    for (const raw of [
      { contact: true, offer: "seo", channels: ["email"], reason: "x" }, // offer not allowed for this lead
      { contact: true, offer: "website_build", channels: ["sms"], reason: "x" }, // channel that doesn't exist
      { contact: true, offer: "website_build", channels: [], reason: "x" }, // contact with no channel
      null,
      "contact them",
      {},
    ]) expect(validateDecision(raw, m, facts())).toEqual(dflt);
  });

  it("drops only the call when Voizo has no script for the chosen offer", () => {
    const d = validateDecision({ contact: true, offer: "ai_booking", channels: ["email", "call"], reason: "x" }, m, facts());
    expect(d).toMatchObject({ offer: "ai_booking", channels: ["email"], source: "ai" });
  });

  it("a lead the code skipped stays skipped whatever the AI says", () => {
    const f = facts({ inOtherJob: true });
    const d = validateDecision({ contact: true, offer: "website_build", channels: ["email"], reason: "x" }, allowedMoves(f, S), f);
    expect(d).toEqual({ contact: false, offer: null, channels: [], reason: "Already in another brain job", source: "rule" });
  });

  it("cuts a long reason to 240 characters", () => {
    const d = validateDecision({ contact: true, offer: "website_build", channels: ["email"], reason: "y".repeat(500) }, m, facts());
    expect(d.reason.length).toBe(240);
  });
});

describe("settings and money", () => {
  it("starts from the operator's defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({ budgetUsd: 20, channels: { email: true, form: true, call: true }, perDay: { emails: 10, forms: 10, calls: 5 }, followUps: 0, includeEu: false });
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps what comes from the browser", () => {
    const s = cleanSettings({ budgetUsd: 99999, channels: { email: true, form: "yes", call: false }, perDay: { emails: 0, forms: 999, calls: -1 }, followUps: 9, includeEu: 1 });
    expect(s).toEqual({ budgetUsd: 500, channels: { email: true, form: false, call: false }, perDay: { emails: 1, forms: 20, calls: 0 }, followUps: 3, includeEu: false });
  });

  it("estimates a job and guards the budget", () => {
    expect(jobEstimate({ searchUsd: 0.96, leads: 100, formLeads: 30 })).toEqual({ searchUsd: 0.96, judgeUsd: 1, formsUsd: 3, totalUsd: 4.96 });
    expect(canSpend(19.9, 0.1, 20)).toBe(true);
    expect(canSpend(19.95, 0.1, 20)).toBe(false);
  });
});
