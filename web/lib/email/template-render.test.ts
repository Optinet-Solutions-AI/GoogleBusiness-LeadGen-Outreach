/**
 * template-render.test.ts — saved email templates fill their {{tokens}} per lead, drop empty lines, flag typos.
 *
 * Inputs:  template text + lead values
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { renderTemplate, TEMPLATE_TOKENS, unknownTokens, varsForLead } from "./template-render";

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
