import { describe, expect, it } from "vitest";
import { CLOSED, addContact, allowEmail, allowPhone, allowUrl, parseTestMode, removeContact } from "./test-mode-rules";

const ON = parseTestMode({ on: true, emails: ["QA@Example.com"], phones: ["+1 512 555 0123"], hosts: ["www.rateup-app.test"] });

describe("test mode rules", () => {
  it("lets only the test contacts through while it's on", () => {
    expect(allowEmail(ON, "qa@example.com ")).toBe(true);
    expect(allowEmail(ON, "owner@realplumber.com")).toBe(false);
    expect(allowEmail(ON, null)).toBe(false);
    expect(allowPhone(ON, "(512) 555-0123")).toBe(true);
    expect(allowPhone(ON, "15125550123")).toBe(true);
    expect(allowPhone(ON, "+1 512 555 0199")).toBe(false);
    expect(allowPhone(ON, "")).toBe(false);
    expect(allowUrl(ON, "https://rateup-app.test/test-form")).toBe(true);
    expect(allowUrl(ON, "rateup-app.test/contact")).toBe(true);
    expect(allowUrl(ON, "https://realplumber.com/contact")).toBe(false);
    expect(allowUrl(ON, "https://rateup-app.test.evil.com/x")).toBe(false);
    expect(allowUrl(ON, "not a url")).toBe(false);
  });

  it("lets everything through once switched off", () => {
    const off = parseTestMode({ on: false, emails: [], phones: [], hosts: [] });
    expect(allowEmail(off, "owner@realplumber.com")).toBe(true);
    expect(allowPhone(off, "+1 512 555 0199")).toBe(true);
    expect(allowUrl(off, "https://realplumber.com/contact")).toBe(true);
  });

  it("fails closed: an unreadable setting blocks everything", () => {
    for (const raw of [null, undefined, "on", 42, {}]) {
      const m = parseTestMode(raw);
      expect(m.on, String(raw)).toBe(true);
      expect(allowEmail(m, "qa@example.com")).toBe(false);
    }
    expect(allowPhone(CLOSED, "+15125550123")).toBe(false);
    // Only an explicit false switches it off.
    expect(parseTestMode({ on: "false" }).on).toBe(true);
    expect(parseTestMode({ on: 0 }).on).toBe(true);
  });

  it("ignores junk in the lists", () => {
    const m = parseTestMode({ on: true, emails: ["", 5, "a@b.c"], phones: ["123", "+44 20 7946 0958"], hosts: [null, "X.com"] });
    expect(m).toEqual({ on: true, emails: ["a@b.c"], phones: ["+44 20 7946 0958"], hosts: ["x.com"] });
  });
});


describe("QA edits the test list (26 Nov 2026)", () => {
  const base = parseTestMode({ on: true, emails: ["a@b.co"], phones: [], hosts: ["app.test"] });

  it("adds an email or a phone, cleaned, once", () => {
    const r = addContact(base, "email", "  QA@Example.com ");
    expect(r).toEqual({ ok: true, mode: { ...base, emails: ["a@b.co", "qa@example.com"] } });
    if (r.ok) expect(addContact(r.mode, "email", "qa@example.com")).toMatchObject({ ok: false, message: expect.stringMatching(/already/) });
    expect(addContact(base, "phone", "+1 (512) 555-0123")).toEqual({ ok: true, mode: { ...base, phones: ["+15125550123"] } });
  });

  it("refuses what isn't an email or a full phone number", () => {
    expect(addContact(base, "email", "not an email")).toMatchObject({ ok: false });
    expect(addContact(base, "phone", "555 0123")).toMatchObject({ ok: false, message: expect.stringMatching(/country code/) });
    expect(addContact(base, "phone", "call me")).toMatchObject({ ok: false });
  });

  it("never switches Test mode on or off, and never touches the website list", () => {
    const off = { ...base, on: false };
    const r = addContact(off, "email", "qa@example.com");
    expect(r.ok && r.mode.on).toBe(false);
    const r2 = addContact(base, "email", "qa@example.com");
    expect(r2.ok && r2.mode.on).toBe(true);
    const removed = removeContact(base, "email", "A@B.co");
    expect(removed).toEqual({ ...base, emails: [] });
    expect(removed.hosts).toEqual(["app.test"]);
    expect(removeContact(base, "phone", "+15125550123").on).toBe(true);
  });
});
