/**
 * openai-profile.test.ts — the AI profile keeps only sourced, cleaned facts.
 *
 * Inputs:  fake Responses API bodies
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));

import { parseProfile, profilePrompt } from "./openai-profile";

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
