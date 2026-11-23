/**
 * email-reach.test.ts — which AI Lookup emails reach the business itself, and which reach its head office or an agency
 * (QA 23 Nov 2026: Pop-A-Lock Mobile got franchise@popalock.com, Roto-Rooter Memphis got marketing@rrsc.com).
 *
 * Inputs:  AI Lookup results (emails + who each reaches)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { firstOwnEmail, isOwnEmail, notOwnEmails } from "./email-reach";

describe("isOwnEmail", () => {
  it("trusts the scope AI Lookup gave", () => {
    const p = { email_scope: { "franchise@popalock.com": "head_office" as const, "mobile@popalock.com": "own" as const } };
    expect(isOwnEmail("franchise@popalock.com", p)).toBe(false);
    expect(isOwnEmail("Mobile@PopALock.com", p)).toBe(true);
  });
  it("older results without a scope: a note naming corporate, a franchise, a parent or head office means not theirs", () => {
    const notes = {
      "marketing@rrsc.com": "Service marketing / business development at Roto-Rooter corporate",
      "franchise@1tomplumber.com": "Franchise / parent company contact",
      "franchise@popalock.com": "Pop-A-Lock franchise development team",
      "pr@agency.gr": "Their PR agency in Greece",
      "info@nepmem.com": "General business inquiries / office",
    };
    expect(isOwnEmail("marketing@rrsc.com", { email_notes: notes })).toBe(false);
    expect(isOwnEmail("franchise@1tomplumber.com", { email_notes: notes })).toBe(false);
    expect(isOwnEmail("franchise@popalock.com", { email_notes: notes })).toBe(false);
    expect(isOwnEmail("pr@agency.gr", { email_notes: notes })).toBe(false);
    expect(isOwnEmail("info@nepmem.com", { email_notes: notes })).toBe(true);
    expect(isOwnEmail("someone@x.com", {})).toBe(true);
  });
});

describe("firstOwnEmail / notOwnEmails", () => {
  const p = {
    emails: ["franchise@1tomplumber.com", "memphis@1tomplumber.com"],
    email_notes: { "franchise@1tomplumber.com": "Franchise / parent company contact", "memphis@1tomplumber.com": "Memphis-area office" },
  };
  it("the first email that reaches the business itself", () => expect(firstOwnEmail(p)).toBe("memphis@1tomplumber.com"));
  it("none when every email is a head-office one", () =>
    expect(firstOwnEmail({ emails: ["marketing@rrsc.com"], email_notes: { "marketing@rrsc.com": "Roto-Rooter corporate" } })).toBeNull());
  it("lists the ones that aren't theirs", () => expect(notOwnEmails(p)).toEqual(["franchise@1tomplumber.com"]));
});
