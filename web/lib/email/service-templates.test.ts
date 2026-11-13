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
