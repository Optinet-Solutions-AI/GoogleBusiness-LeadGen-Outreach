/**
 * sequence-templates.test.ts — Lock the per-step / per-variant invariants of the
 * progressive-trust email copy: step 1 has no image or link, step 2 carries the
 * screenshot marker but no link, step 3 has the link but no screenshot, step 4
 * is a plain close. Also: tokens fill and spintax fully resolves.
 */

import { describe, it, expect } from "vitest";
import { renderSequenceEmail, variantFor, type SeqLead, type SeqStep } from "./sequence-templates";

const SCREENSHOT_MARKER = "<!--SCREENSHOT-->";

function leadFor(segment: "no_website" | "old_website"): SeqLead {
  return {
    business_name: "Joe's Plumbing",
    demo_url: "https://joes-plumbing.pages.dev",
    call_segment: segment,
  };
}

describe("variantFor", () => {
  it("maps old_website to improve and everything else to build", () => {
    expect(variantFor("old_website")).toBe("improve");
    expect(variantFor("no_website")).toBe("build");
    expect(variantFor(null)).toBe("build");
    expect(variantFor(undefined)).toBe("build");
  });
});

describe.each(["no_website", "old_website"] as const)("renderSequenceEmail (%s)", (segment) => {
  const lead = leadFor(segment);

  it("step 1: plain text — no image, no link", () => {
    const r = renderSequenceEmail(lead, 1);
    expect(r.useScreenshot).toBe(false);
    expect(r.useLink).toBe(false);
    expect(r.html).not.toContain(SCREENSHOT_MARKER);
    expect(r.html).not.toContain("<a ");
    expect(r.html).not.toContain("cid:");
  });

  it("step 2: screenshot marker present, still no link", () => {
    const r = renderSequenceEmail(lead, 2);
    expect(r.useScreenshot).toBe(true);
    expect(r.useLink).toBe(false);
    expect(r.html).toContain(SCREENSHOT_MARKER);
    expect(r.html).not.toContain("<a ");
  });

  it("step 3: live link present, no screenshot", () => {
    const r = renderSequenceEmail(lead, 3);
    expect(r.useScreenshot).toBe(false);
    expect(r.useLink).toBe(true);
    expect(r.html).toContain(`href="${lead.demo_url}"`);
    expect(r.html).not.toContain(SCREENSHOT_MARKER);
  });

  it("step 4: plain break-up — no image, no link", () => {
    const r = renderSequenceEmail(lead, 4);
    expect(r.useScreenshot).toBe(false);
    expect(r.useLink).toBe(false);
    expect(r.html).not.toContain(SCREENSHOT_MARKER);
    expect(r.html).not.toContain("<a ");
  });

  it("fills the business name and fully resolves spintax (no stray braces)", () => {
    for (const step of [1, 2, 3, 4] as SeqStep[]) {
      const r = renderSequenceEmail(lead, step);
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.html).toContain("Joe's Plumbing");
      // spintax {a|b} must be gone after resolution
      expect(r.subject).not.toMatch(/[{}]/);
      expect(r.html).not.toMatch(/[{}]/);
    }
  });
});
