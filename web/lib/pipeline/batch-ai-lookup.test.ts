/**
 * batch-ai-lookup.test.ts — scraping runs AI Lookup: its findings fill the same contact fields as before and the full
 * result is kept on the lead (so the research panel and the Google vs AI box are ready without a click).
 *
 * Inputs:  AiProfile-like results, a lead row
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { contactsFromProfile, keepProfileOnRow } from "./batch-ai-lookup";

const P = {
  summary: "Food trucks", what_they_do: null, owner_name: "Ravi", owner_role: "Owner", people: [], emails: ["info@renuka.in"],
  phones: ["+91 98480 00000"], website: "https://renuka.in", contact_url: "https://renuka.in/contact", address: null, hours: null,
  socials: [], services: [], founded: null, size: null, reviews: null, sources: ["https://renuka.in"], usd: 0.031,
};

describe("contactsFromProfile", () => {
  it("first email / phone, contact page, owner, sources and cost", () => {
    expect(contactsFromProfile(P)).toEqual({
      email: "info@renuka.in", phone: "+91 98480 00000", contact_url: "https://renuka.in/contact",
      owner_name: "Ravi", owner_role: "Owner", sources: ["https://renuka.in"], usd: 0.031,
    });
  });
  it("nothing found → nulls", () => {
    expect(contactsFromProfile({ ...P, emails: [], phones: [], contact_url: null, owner_name: null, owner_role: null })).toMatchObject({ email: null, phone: null, owner_name: null });
  });
});

describe("keepProfileOnRow", () => {
  it("saves the whole result (no decisions yet) with a time, and never touches the website", () => {
    const row: Record<string, unknown> = { website_url: null, has_website: false };
    keepProfileOnRow(row, P, "2026-11-20T10:00:00.000Z");
    expect(row.ai_profile).toEqual({ ...P, decisions: {} });
    expect(row.ai_profile_at).toBe("2026-11-20T10:00:00.000Z");
    expect(row.website_url).toBeNull();
    expect(row.has_website).toBe(false);
  });
});
