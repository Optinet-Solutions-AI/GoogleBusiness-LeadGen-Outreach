/**
 * template-render.test.ts — saved email templates fill their {{tokens}} per lead, drop empty lines, flag typos.
 *
 * Inputs:  template text + lead values
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { leftoverTokens, renderTemplate, TEMPLATE_TOKENS, tokenize, unknownTokens, usesToken, varsForLead } from "./template-render";

describe("renderTemplate", () => {
  it("fills every token", () => {
    expect(renderTemplate("Hi {{first_name}}, {{business}} in {{city}}", { first_name: "Joe", business: "Acme", city: "Austin" })).toBe(
      "Hi Joe, Acme in Austin",
    );
  });
  it("drops a line whose only token is empty (no demo site), with no blank gap", () => {
    const text = "Hi Joe,\n\nI made a sample:\n{{demo_link}}\n\nWhat do you think?";
    expect(renderTemplate(text, { demo_link: null })).toBe("Hi Joe,\n\nI made a sample:\n\nWhat do you think?");
    expect(renderTemplate(text, { demo_link: "https://acme.pages.dev" })).toContain("https://acme.pages.dev");
  });
  it("leaves an unknown token visible so the operator sees it", () => {
    expect(renderTemplate("Hi {{bussiness}}", { business: "Acme" })).toBe("Hi {{bussiness}}");
  });
});

describe("unknownTokens", () => {
  it("lists typos and ignores the real tokens", () => {
    expect(unknownTokens("{{business}} {{bussiness}} {{ City }} {{rating}}")).toEqual(["bussiness", "City"]);
    expect(TEMPLATE_TOKENS).toContain("demo_link");
  });
});

describe("varsForLead", () => {
  it("uses the first names, the city before the comma, and readable rating / review text", () => {
    expect(
      varsForLead({
        businessName: "Acme Diner",
        ownerName: "Joe Smith",
        city: "Austin, TX",
        platform: "TripAdvisor",
        rating: 2.4,
        reviewCount: 38,
        senderName: "Ethan Cole",
      }),
    ).toMatchObject({ business: "Acme Diner", first_name: "Joe", city: "Austin", site: "TripAdvisor", rating: "2.4★", reviews: "38 reviews", sender: "Ethan" });
  });
  it("says 'there' when there's no owner name", () => {
    expect(varsForLead({ businessName: "Acme" }).first_name).toBe("there");
  });
});

describe("tokenize (Save as template from Send email)", () => {
  const vars = varsForLead({ businessName: "Acme Diner", ownerName: "Joe Smith", city: "Austin, TX", demoUrl: "https://acme.pages.dev", senderName: "Ethan Cole" });
  it("turns this lead's details back into placeholders so the template works for any lead", () => {
    expect(tokenize("Hi Joe,\n\nAcme Diner in Austin: https://acme.pages.dev\n\nThanks,\nEthan", vars)).toBe(
      "Hi {{first_name}},\n\n{{business}} in {{city}}: {{demo_link}}\n\nThanks,\n{{sender}}",
    );
  });
  it("only replaces whole words and leaves the generic 'there' alone", () => {
    const v = varsForLead({ businessName: "Acme", ownerName: null });
    expect(tokenize("Hi there, Acmeville loves Acme.", v)).toBe("Hi there, Acmeville loves {{business}}.");
  });
  it("round-trips: tokenize then render gives the same text back", () => {
    const text = "Hi Joe, Acme Diner in Austin";
    expect(renderTemplate(tokenize(text, vars), vars)).toBe(text);
  });
});

describe("send-time checks for saved templates", () => {
  it("leftoverTokens finds any {{placeholder}} still in the text, so it's never sent", () => {
    expect(leftoverTokens(["Hi {{bussiness}}", "fine", "{{ City }}"])).toEqual(["bussiness", "City"]);
    expect(leftoverTokens(["Hi Joe"])).toEqual([]);
  });
  it("usesToken tells whether a template mentions the demo link (then a lead without a demo is blocked)", () => {
    expect(usesToken(["Hi", "Sample:\n{{demo_link}}"], "demo_link")).toBe(true);
    expect(usesToken(["Hi {{ demo_link }}"], "demo_link")).toBe(true);
    expect(usesToken(["Hi {{business}}"], "demo_link")).toBe(false);
  });
});

describe("tokenize — only clear matches become placeholders", () => {
  it("uses the owner's name only in the greeting, and the sender's only on the sign-off line", () => {
    const v = varsForLead({ businessName: "Acme", ownerName: "Will Smith", senderName: "Grace Lee" });
    expect(tokenize("Hi Will,\nWill you take a look?\nGrace will call.\nThanks,\nGrace", v)).toBe(
      "Hi {{first_name}},\nWill you take a look?\nGrace will call.\nThanks,\n{{sender}}",
    );
  });
  it("matches the category in any case (the built-in emails lowercase it)", () => {
    const v = varsForLead({ businessName: "Acme", category: "Plumber" });
    expect(tokenize("people search for a plumber online", v)).toBe("people search for a {{category}} online");
  });
  it("leaves numbers and very short values alone", () => {
    const v = varsForLead({ businessName: "Acme", booth: "12", city: "NY" });
    expect(tokenize("see you at 12 noon in NY", v)).toBe("see you at 12 noon in NY");
  });
  it("doesn't match inside a longer word or domain", () => {
    const v = varsForLead({ businessName: "Acme Co." });
    expect(tokenize("Visit acmeco.uk or Acme Co.uk, says Acme Co.", v)).toBe("Visit acmeco.uk or Acme Co.uk, says {{business}}");
  });
});
