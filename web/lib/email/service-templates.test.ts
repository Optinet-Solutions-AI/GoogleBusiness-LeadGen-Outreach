/**
 * service-templates.test.ts — the ready-made emails behind the Send email window's service list.
 *
 * Inputs:  sample leads
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { SERVICES, serviceEmail, defaultService, replySubject, isServiceKey, type ServiceKey } from "./service-templates";
import { spamCheck } from "./spam-check";
import { textToHtml } from "./plain-text";

const LEAD = {
  businessName: "Joe's Plumbing",
  ownerName: "Dana Smith",
  city: "Austin, TX",
  category: "Plumber",
  senderName: "Sam Cole",
};

describe("serviceEmail", () => {
  it("fills every service with the lead's details, signed by the sender", () => {
    for (const { key } of SERVICES.filter((s) => s.key !== "custom")) {
      const e = serviceEmail(key, LEAD);
      expect(e.subject, key).not.toBe("");
      expect(e.body, key).toMatch(/^Hi Dana,/);
      expect(e.body, key).toMatch(/Thanks,\nSam$|won't email again\.$/);
      expect(e.followUps.every((f) => f.startsWith("Hi Dana,")), key).toBe(true);
      // No leftover placeholders or spintax.
      expect(`${e.subject}${e.body}${e.followUps.join("")}`, key).not.toMatch(/[{}]|undefined|null/);
    }
  });

  it("greets 'there' and signs plainly when we know no names", () => {
    const e = serviceEmail("seo", { businessName: "Acme" });
    expect(e.body.startsWith("Hi there,")).toBe(true);
    expect(e.body.endsWith("Thanks")).toBe(true);
  });

  it("links the demo when there is one, and offers a free sample when there isn't", () => {
    const withDemo = serviceEmail("website_build", { ...LEAD, demoUrl: "https://joes.pages.dev" });
    expect(withDemo.body).toContain("https://joes.pages.dev");
    expect(withDemo.followUps[0]).toContain("https://joes.pages.dev");
    const noDemo = serviceEmail("website_build", LEAD);
    expect(noDemo.body).not.toContain("http");
    expect(noDemo.body).toContain("make you a sample first, on us");
  });

  it("names the trade show and stand for exhibitors", () => {
    const e = serviceEmail("booth_build", { businessName: "Acme", eventName: "ICE London", booth: "N4-210" });
    expect(e.subject).toBe("Your stand at ICE London");
    expect(e.body).toContain("at ICE London (stand N4-210)");
  });

  it("uses the city before the comma and the niche in lower case", () => {
    expect(serviceEmail("seo", LEAD).body).toContain("a plumber in Austin.");
  });

  it("keeps every ready-made email and follow-up low on spam-filter risk, with or without a demo", () => {
    for (const demoUrl of ["https://joes.pages.dev", null]) {
      for (const { key } of SERVICES) {
        const e = serviceEmail(key, { ...LEAD, demoUrl });
        expect(spamCheck(e.subject || "Hello", textToHtml(e.body)).level, key).toBe("low");
        for (const f of e.followUps) expect(spamCheck(replySubject(e.subject || "Hello"), textToHtml(f)).level, `${key} follow-up`).toBe("low");
      }
    }
  });

  it("gives 'Write my own' an empty subject and a body to type into", () => {
    const e = serviceEmail("custom", LEAD);
    expect(e.subject).toBe("");
    expect(e.body).toBe("Hi Dana,\n\n\n\nThanks,\nSam");
  });
});

describe("defaultService", () => {
  it.each([
    ["no_website", "website_build"],
    ["old_website", "website_redesign"],
    ["has_website", "ai_receptionist"],
    ["liquidation", "buy_inventory"],
    ["exhibitor", "booth_build"],
    [null, "custom"],
  ] as [string | null, ServiceKey][])("%s → %s", (segment, key) => {
    expect(defaultService(segment)).toBe(key);
  });
});

describe("helpers", () => {
  it("threads follow-ups as replies without stacking Re:", () => {
    expect(replySubject("A website for Joe's")).toBe("Re: A website for Joe's");
    expect(replySubject("RE: hello")).toBe("RE: hello");
  });
  it("recognises service keys", () => {
    expect(isServiceKey("seo")).toBe(true);
    expect(isServiceKey("voice_agent")).toBe(false);
  });
});

describe("reputation management (review-site leads)", () => {
  const lead = { businessName: "Acme Diner", platform: "TripAdvisor", rating: 2.4, reviewCount: 38, senderName: "Ethan Cole" };
  it("is offered and is the default for the reputation segment", () => {
    expect(SERVICES.some((s) => s.key === "reputation_mgmt")).toBe(true);
    expect(defaultService("reputation")).toBe("reputation_mgmt");
  });
  it("names the site, the rating and the review count, with no spam words", () => {
    const e = serviceEmail("reputation_mgmt", lead);
    expect(e.subject).toBe("Acme Diner's TripAdvisor rating");
    expect(e.body).toContain("2.4");
    expect(e.body).toContain("38 reviews");
    expect(e.body).toContain("OptiRate");
    expect(e.body).toMatch(/Just reply "no"/);
    expect(e.body.toLowerCase()).not.toContain("free");
    expect(spamCheck(e.subject, textToHtml(e.body)).level).toBe("low");
    expect(e.followUps.every((f) => f.length > 0)).toBe(true);
  });
  it("still reads well when the rating is unknown", () => {
    const e = serviceEmail("reputation_mgmt", { businessName: "Acme", platform: "Trustpilot" });
    expect(e.subject).toBe("Acme's Trustpilot rating");
    expect(e.body).not.toMatch(/undefined|null|NaN/);
  });
});
