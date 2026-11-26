import { describe, expect, it } from "vitest";
import { CLOSED, allowEmail, allowPhone, allowUrl, parseTestMode } from "./test-mode-rules";

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
