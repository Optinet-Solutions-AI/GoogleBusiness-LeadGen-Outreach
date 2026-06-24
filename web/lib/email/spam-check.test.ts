/**
 * spam-check.test.ts — locks the outbound spam-risk heuristics.
 */
import { describe, it, expect } from "vitest";
import { spamCheck } from "./spam-check";
import { renderSequenceEmail } from "./sequence-templates";

describe("spamCheck", () => {
  it("passes clean conversational copy", () => {
    const r = spamCheck("An idea for Joe's Diner", "<p>Hi Joe, quick question about your bookings.</p>");
    expect(r.level).toBe("low");
    expect(r.flags).toHaveLength(0);
  });

  it("flags em / en dashes (AI tell)", () => {
    const r = spamCheck("Hello", "<p>This is great &mdash; really.</p>");
    expect(r.flags.some((f) => f.includes("dash"))).toBe(true);
  });

  it("flags classic spam phrases, caps, links and money", () => {
    const r = spamCheck(
      "ACT NOW for a 100% FREE guarantee!!",
      '<p>Click here to BUY NOW and save $500. <a href="#">a</a><a href="#">b</a><a href="#">c</a></p>',
    );
    expect(r.level).toBe("high");
    expect(r.score).toBeGreaterThan(2);
  });

  it("clears every rendered sequence step across all three variants", () => {
    const segments = ["no_website", "old_website", "has_website"];
    for (const seg of segments) {
      for (const step of [1, 2, 3, 4] as const) {
        const lead = { business_name: "Bright Smile Dental", call_segment: seg, demo_url: "https://x.pages.dev" };
        const r = renderSequenceEmail(lead, step);
        expect(spamCheck(r.subject, r.html).level, `${seg} step ${step}`).toBe("low");
      }
    }
  });
});
