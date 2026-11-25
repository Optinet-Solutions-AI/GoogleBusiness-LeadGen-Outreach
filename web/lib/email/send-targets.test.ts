/**
 * send-targets.test.ts — Send email's "Send to: Email / Contact page / Both" (Meny, 25 Nov 2026).
 *
 * Inputs:  what the lead has (an email we may use, a contact page on its own site)
 * Outputs: vitest assertions on which channels go and the plain reason when one can't
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { sendTargets, targetChoices } from "./send-targets";

describe("sendTargets", () => {
  const both = { canEmail: true, contactPage: "https://joes.com/contact" };
  it("email only, contact page only, or both", () => {
    expect(sendTargets("email", both)).toEqual({ email: true, form: false, problem: null });
    expect(sendTargets("form", both)).toEqual({ email: false, form: true, problem: null });
    expect(sendTargets("both", both)).toEqual({ email: true, form: true, problem: null });
  });
  it("says why when the lead lacks what the choice needs", () => {
    expect(sendTargets("form", { canEmail: true, contactPage: null }).problem).toMatch(/no contact page/i);
    expect(sendTargets("both", { canEmail: false, contactPage: "https://joes.com/contact" }).problem).toMatch(/can't be emailed/i);
    expect(sendTargets("email", { canEmail: false, contactPage: null }).problem).toMatch(/can't be emailed/i);
  });
});

describe("targetChoices (what the window offers)", () => {
  it("only the channels the lead has", () => {
    expect(targetChoices({ canEmail: true, contactPage: "https://joes.com/contact" })).toEqual(["email", "form", "both"]);
    expect(targetChoices({ canEmail: true, contactPage: null })).toEqual(["email"]);
    expect(targetChoices({ canEmail: false, contactPage: "https://joes.com/contact" })).toEqual(["form"]);
    expect(targetChoices({ canEmail: false, contactPage: null })).toEqual([]);
  });
});
