/**
 * contact-edit.test.ts — typing a lead's phone, website or contact page by hand (QA 23 Nov 2026: only the email could
 * be corrected).
 *
 * Inputs:  what the operator typed
 * Outputs: vitest assertions on the saved fields or the plain refusal
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { contactEditPatch } from "./contact-edit";

describe("contactEditPatch", () => {
  it("saves a phone as typed, and an empty box removes it", () => {
    expect(contactEditPatch({ phone: " (251) 338-9202 " })).toEqual({ ok: true, patch: { phone: "(251) 338-9202" } });
    expect(contactEditPatch({ phone: "" })).toEqual({ ok: true, patch: { phone: null } });
  });
  it("refuses something that isn't a phone number", () =>
    expect(contactEditPatch({ phone: "call me" })).toEqual({ ok: false, error: "That doesn't look like a phone number." }));

  it("a new website: https is added, it counts as a real site, and the old site's check is cleared", () =>
    expect(contactEditPatch({ website_url: "discountlocksmithal.com" })).toEqual({
      ok: true,
      patch: {
        website_url: "https://discountlocksmithal.com",
        website_kind: "real",
        has_website: true,
        website_score: null,
        website_issues: [],
        website_status: null,
        needs_improvement: null,
        audited_at: null,
        website_review: null,
        website_reviewed_at: null,
      },
    }));
  it("a Facebook page is saved as their Facebook, not as a real website", () =>
    expect(contactEditPatch({ website_url: "https://facebook.com/joes" })).toMatchObject({ ok: true, patch: { website_kind: "facebook", has_website: false } }));
  it("an empty website box removes it", () =>
    expect(contactEditPatch({ website_url: "" })).toMatchObject({ ok: true, patch: { website_url: null, website_kind: "none", has_website: false } }));
  it("refuses a website that isn't a web address", () =>
    expect(contactEditPatch({ website_url: "not a site" })).toEqual({ ok: false, error: "That doesn't look like a web address." }));

  it("a contact page is saved as a full web address; empty removes it", () => {
    expect(contactEditPatch({ contact_page_url: "discountlocksmithal.com/contact/" })).toEqual({ ok: true, patch: { contact_page_url: "https://discountlocksmithal.com/contact/" } });
    expect(contactEditPatch({ contact_page_url: " " })).toEqual({ ok: true, patch: { contact_page_url: null } });
  });
});
