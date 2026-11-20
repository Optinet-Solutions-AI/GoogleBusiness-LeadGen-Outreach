/**
 * research-review.test.ts — research findings as Verify / Remove lines; a replaced email / phone is never lost.
 *
 * Inputs:  sample research + lead contact fields
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { reviewRows, swapIn, samePhone, sameEmailValue, type ResearchView } from "./research-review";

const R: ResearchView = {
  summary: "Plumbers.",
  what_they_do: "Plumbing",
  owner_name: "Dana Smith",
  owner_role: "Owner",
  people: [],
  emails: ["info@joes.com", "dana@joes.com"],
  phones: ["+1 512 555 0123"],
  website: "https://joes.com",
  contact_url: "https://joes.com/contact",
  address: null,
  hours: null,
  socials: [],
  services: [],
  founded: null,
  size: null,
  reviews: null,
  sources: ["https://joes.com"],
  decisions: {},
};
const LEAD = { email: "info@joes.com", phone: "(512) 555-0123", contact_owner_name: null, contact_page_url: null };

describe("reviewRows", () => {
  it("marks what the lead already uses, and the rest as new", () => {
    const rows = reviewRows(R, LEAD);
    const state = Object.fromEntries(rows.map((r) => [r.key, r.state]));
    expect(state["email:info@joes.com"]).toBe("in_use");
    expect(state["email:dana@joes.com"]).toBe("new");
    expect(state["phone:15125550123"]).toBe("in_use");
    expect(state.owner).toBe("new");
    expect(state.contact_url).toBe("new");
    expect(state.what_they_do).toBe("new");
  });
  it("shows verified details as checked and leaves removed ones out", () => {
    const rows = reviewRows({ ...R, decisions: { what_they_do: "verified", "email:dana@joes.com": "removed" } }, LEAD);
    expect(rows.find((r) => r.key === "what_they_do")?.state).toBe("verified");
    expect(rows.some((r) => r.key === "email:dana@joes.com")).toBe(false);
  });
});

describe("swapIn", () => {
  const now = "2026-11-15T10:00:00.000Z";
  it("keeps the old main email on top and takes the new one out of the list", () => {
    const list = [{ value: "dana@joes.com", source: "research", added_at: "x" }];
    expect(swapIn(list, "info@joes.com", "dana@joes.com", sameEmailValue, now)).toEqual([
      { value: "info@joes.com", source: "replaced", added_at: now },
    ]);
  });
  it("never adds an empty or identical main value, and drops duplicates", () => {
    expect(swapIn(null, null, "a@x.com", sameEmailValue, now)).toEqual([]);
    expect(swapIn(null, "A@X.com", "a@x.com", sameEmailValue, now)).toEqual([]);
    const list = [{ value: "+1 512 000 1111", source: "replaced", added_at: "x" }];
    expect(swapIn(list, "(512) 000-1111", "+1 512 555 0123", samePhone, now)).toHaveLength(1);
  });
});

describe("samePhone", () => {
  it("matches the same number written differently", () => {
    expect(samePhone("+1 512 555 0123", "(512) 555-0123")).toBe(true);
    expect(samePhone("+1 512 555 0123", "+1 512 555 9999")).toBe(false);
    expect(samePhone(null, "")).toBe(false);
  });
});

describe("reviewRows website (QA 20 Nov 2026)", () => {
  it("an old result with a social homepage or business.site shows no Website line", () => {
    expect(reviewRows({ ...R, website: "https://www.facebook.com" }, LEAD).some((r) => r.key === "website")).toBe(false);
    expect(reviewRows({ ...R, website: "https://renuka.business.site" }, LEAD).some((r) => r.key === "website")).toBe(false);
    expect(reviewRows(R, LEAD).some((r) => r.key === "website")).toBe(true);
  });
});

describe("reviewRows email notes", () => {
  it("shows who each email reaches", () => {
    const rows = reviewRows({ ...R, emails: ["press@sony.com"], email_notes: { "press@sony.com": "PlayStation press team" } }, LEAD);
    expect(rows.find((r) => r.kind === "email")?.text).toBe("press@sony.com — PlayStation press team");
  });
});
