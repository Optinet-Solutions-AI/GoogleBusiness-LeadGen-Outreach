/**
 * ai-profile.test.ts — the AI profile fills only empty contact fields, and reads as clear bullets.
 *
 * Inputs:  sample leads + profiles
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { contactFill } from "./ai-profile";
import { profileBullets, profileNote } from "./ai-profile-view";
import type { AiProfile } from "@/lib/services/openai-profile";

const PROFILE: AiProfile = {
  summary: "Family-run plumbers.",
  what_they_do: "Plumbing",
  owner_name: "Dana Smith",
  owner_role: "Owner",
  people: [{ name: "Lee Park", role: null }],
  emails: ["info@joes.com"],
  phones: ["+15125550123"],
  website: "https://joes.com/",
  contact_url: "https://joes.com/contact",
  address: null,
  hours: null,
  socials: [{ platform: "Facebook", url: "https://facebook.com/joes" }],
  services: ["Leaks", "Heaters"],
  founded: null,
  size: null,
  reviews: "4.8 (120)",
  sources: ["https://joes.com/about"],
  usd: 0.03,
};
const LEAD = {
  id: "L1", business_name: "Joe's", address: null, country_code: "us", category: null, website_url: null,
  email: null, phone: null, contact_page_url: null, contact_owner_name: null, contact_owner_role: null, contact_sources: ["https://old.example"],
};

describe("contactFill", () => {
  it("fills empty fields, starts the new email unchecked, and merges sources", () => {
    const { patch, filled } = contactFill(LEAD, PROFILE);
    expect(filled).toEqual(["email", "phone", "owner", "contact page"]);
    expect(patch).toMatchObject({ email: "info@joes.com", verification_status: null, phone: "+15125550123", contact_owner_name: "Dana Smith" });
    expect(patch.contact_sources).toEqual(["https://old.example", "https://joes.com/about"]);
  });
  it("never overwrites what the lead already has", () => {
    const { patch, filled } = contactFill(
      { ...LEAD, email: "owner@joes.com", phone: "+1 512 000", contact_owner_name: "Sam", contact_page_url: "https://joes.com/c" },
      PROFILE,
    );
    expect(filled).toEqual([]);
    expect(patch).toEqual({});
  });
});

describe("profileBullets", () => {
  it("lists only what was found, in a fixed order", () => {
    const b = profileBullets(PROFILE);
    expect(b.map((x) => x.label)).toEqual(["What they do", "Owner", "Other people", "Email", "Phone", "Website", "Contact page", "Social", "Services", "Reviews"]);
    expect(b.find((x) => x.label === "Owner")?.text).toBe("Dana Smith (Owner)");
    expect(b.find((x) => x.label === "Website")?.links?.[0].label).toBe("joes.com");
  });
  it("writes a plain-text note for the CRM timeline", () => {
    const n = profileNote(PROFILE);
    expect(n.startsWith("AI profile: Family-run plumbers.")).toBe(true);
    expect(n).toContain("• Owner: Dana Smith (Owner)");
  });
});
