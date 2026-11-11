/**
 * research-contact.test.ts — the one-line result shown after "Find contacts (AI)".
 *
 * Inputs:  ResearchOutcome shapes
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
vi.mock("@/lib/pipeline/contact-research", () => ({ researchContacts: vi.fn() }));
vi.mock("@/lib/services/openai-contacts", () => ({ findContactsWithAI: vi.fn() }));
vi.mock("@/lib/services/openai-health", () => ({ getOpenAiHealth: vi.fn() }));
vi.mock("@/lib/services/website-email", () => ({ findWebsiteContacts: vi.fn() }));

import { describeOutcome, type ResearchOutcome } from "./research-contact";

const base: ResearchOutcome = {
  email: null, phone: null, contact_page_url: null, contact_owner_name: null, contact_owner_role: null, contact_sources: [],
  found: { email: false, phone: false, owner: false, contact_page: false }, ai_state: "ok", usd: 0.03,
};

describe("describeOutcome", () => {
  it("lists what was newly found", () => {
    const t = describeOutcome({ ...base, email: "x@y.com", contact_owner_name: "Robert Ellul", contact_owner_role: "Owner", found: { ...base.found, email: true, owner: true } });
    expect(t).toBe("Found: email x@y.com, contact Robert Ellul (Owner).");
  });
  it("says when nothing new turned up but existing data was confirmed", () => {
    const t = describeOutcome({ ...base, email: "x@y.com", contact_sources: ["https://a", "https://b"] });
    expect(t).toContain("Nothing new");
    expect(t).toContain("2 sources");
  });
  it("says when there is nothing, and when AI was off", () => {
    expect(describeOutcome(base)).toBe("No public contact details found for this business.");
    expect(describeOutcome({ ...base, ai_state: "key_invalid" })).toMatch(/AI research was off \(the OpenAI key was refused/);
  });
});
