/**
 * openai-profile.test.ts — the AI profile keeps only sourced, cleaned facts.
 *
 * Inputs:  fake Responses API bodies
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));

import { lookupSeenAt, parseProfile, profilePrompt } from "./openai-profile";

const body = (obj: unknown) => ({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }] });
const FULL = {
  summary: "Family-run plumbers in Austin since 2004.",
  what_they_do: "Plumbing and heating",
  owner_name: "Dana Smith",
  owner_role: "Owner",
  people: [{ name: "Lee Park", role: "Manager" }, { name: "", role: "x" }],
  emails: ["Info@JoesPlumbing.com", "not-an-email", "noreply@wix.com"],
  phones: ["+1 512 555 0123", "12"],
  website: "https://joesplumbing.com",
  contact_url: "https://joesplumbing.com/contact",
  address: "1 Main St, Austin, TX",
  hours: "Mon–Fri 8–5",
  socials: [{ platform: "Facebook", url: "https://facebook.com/joes" }, { platform: "X", url: "not a url" }],
  services: ["Leak repair", "Water heaters"],
  founded: "2004",
  size: "12 staff",
  reviews: "4.8 on Google (120 reviews)",
  sources: ["https://joesplumbing.com/about", "javascript:alert(1)"],
};

describe("parseProfile", () => {
  it("keeps sourced facts and cleans the lists", () => {
    const p = parseProfile(body(FULL), null, 0.03);
    expect(p.summary).toBe(FULL.summary);
    expect(p.owner_name).toBe("Dana Smith");
    expect(p.people).toEqual([{ name: "Lee Park", role: "Manager" }]);
    expect(p.emails).toEqual(["info@joesplumbing.com"]);
    expect(p.phones).toEqual(["+1 512 555 0123"]);
    expect(p.socials).toEqual([{ platform: "Facebook", url: "https://facebook.com/joes" }]);
    expect(p.sources).toEqual(["https://joesplumbing.com/about"]);
    expect(p.usd).toBe(0.03);
  });

  it("keeps nothing when no source backs it", () => {
    const p = parseProfile(body({ ...FULL, sources: [] }), null, 0.02);
    expect(p.summary).toBeNull();
    expect(p.emails).toEqual([]);
    expect(p.owner_name).toBeNull();
  });

  it("survives an empty or broken answer", () => {
    expect(parseProfile({ output: [] }, null, 0).sources).toEqual([]);
    expect(parseProfile({ output: [{ type: "message", content: [{ type: "output_text", text: "{oops" }] }] }, null, 0).summary).toBeNull();
  });
});

describe("profilePrompt", () => {
  it("names the business and forbids guessed emails", () => {
    const t = profilePrompt({ business_name: "Joe's Plumbing", category: "Plumber", country_code: "us" });
    expect(t).toContain("Business: Joe's Plumbing");
    expect(t).toContain("Type: Plumber");
    expect(t).toContain("Never guess");
  });
});

describe("parseProfile website (QA 20 Nov 2026)", () => {
  it("drops a social homepage or a dead business.site link as the website", () => {
    expect(parseProfile(body({ ...FULL, website: "https://www.facebook.com" }), null, 0).website).toBeNull();
    expect(parseProfile(body({ ...FULL, website: "https://renuka.business.site" }), null, 0).website).toBeNull();
    expect(parseProfile(body(FULL), null, 0).website).toBe("https://joesplumbing.com");
  });
});

describe("who can I email (QA 20 Nov 2026: PlayStation at Gameathlon)", () => {
  const PS = {
    ...FULL,
    website: "https://www.playstation.com",
    owner_name: "Sony Interactive Entertainment",
    owner_role: "Company operating PlayStation",
    emails: [
      { email: "info@onewhole.gr", reaches: "Their PR agency in Greece (partnerships)" },
      { email: "PlaystationPR@sony.com", reaches: "PlayStation press team" },
      { email: "no-reply@sony.com", reaches: "Automated" },
    ],
  };

  it("asks who to email, with the show and region, and steers away from customer support", () => {
    const t = profilePrompt({ business_name: "PlayStation", country_code: "gr", seen_at: "Gameathlon 2026 in Athens (GR)" });
    expect(t).toMatch(/who can I email/i);
    expect(t).toContain("Seen at: Gameathlon 2026 in Athens (GR)");
    expect(t).toMatch(/customer.support/i);
    expect(t).toMatch(/agency/i);
  });

  it("keeps emails on other domains with who each one reaches, drops no-reply", () => {
    const p = parseProfile(body(PS), null, 0);
    expect(p.emails).toEqual(["info@onewhole.gr", "playstationpr@sony.com"]);
    expect(p.email_notes).toEqual({ "info@onewhole.gr": "Their PR agency in Greece (partnerships)", "playstationpr@sony.com": "PlayStation press team" });
  });

  it("still reads a plain list of emails", () => {
    expect(parseProfile(body(FULL), null, 0).emails).toEqual(["info@joesplumbing.com"]);
  });

  it("an owner that is a company, not a person → no owner", () => {
    const p = parseProfile(body(PS), null, 0);
    expect(p.owner_name).toBeNull();
    expect(p.owner_role).toBeNull();
    expect(parseProfile(body(FULL), null, 0).owner_name).toBe("Dana Smith");
  });
});

describe("lookupSeenAt", () => {
  it("a conference lead → the show, city, country and stand", () => {
    expect(lookupSeenAt("exhibitor", { event_name: "Gameathlon 2026", event_city: "Athens", event_country: "gr", booth: "5K40" })).toBe(
      "Gameathlon 2026 in Athens (GR), stand 5K40",
    );
    expect(lookupSeenAt("exhibitor", { event_name: "ICE Barcelona 2026", event_city: null, event_country: null, booth: null })).toBe("ICE Barcelona 2026");
  });
  it("anything else → nothing", () => {
    expect(lookupSeenAt(null, null)).toBeNull();
    expect(lookupSeenAt("exhibitor", {})).toBeNull();
  });
});
