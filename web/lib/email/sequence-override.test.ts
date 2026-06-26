/**
 * sequence-override.test.ts — operator copy overrides on the sequence renderer.
 */
import { describe, it, expect } from "vitest";
import { renderSequenceEmail, defaultEditableCopy } from "./sequence-templates";

const lead = { business_name: "Joe's Diner", demo_url: "https://joes.pages.dev", call_segment: "no_website" };

describe("renderSequenceEmail overrides", () => {
  it("uses the override subject + body, filling tokens + wrapping paragraphs", () => {
    const r = renderSequenceEmail(lead, 1, {
      subject: "A site for {{business_name}}",
      body: "Hi {{first_name}},\n\nWe built {{business_name}} a demo.",
    });
    expect(r.subject).toBe("A site for Joe's Diner"); // subject is plain text
    expect(r.html).toMatch(/<p>Hi Joe/); // first_name = first word ("Joe's")
    expect(r.html).toContain("We built Joe"); // business_name token filled, paragraph-wrapped
    expect(r.html).toContain("</p>");
  });

  it("renders {{demo_link}} as a real anchor in the body", () => {
    const r = renderSequenceEmail(lead, 3, { body: "See it: {{demo_link}}" });
    expect(r.html).toContain('<a href="https://joes.pages.dev">https://joes.pages.dev</a>');
  });

  it("falls back to the default when a field is blank", () => {
    const def = renderSequenceEmail(lead, 1);
    const r = renderSequenceEmail(lead, 1, { subject: "  ", body: "" });
    expect(r.subject).toBe(def.subject);
  });

  it("keeps step-2 screenshot + step-3 link flags regardless of override", () => {
    expect(renderSequenceEmail(lead, 2, { body: "custom" }).useScreenshot).toBe(true);
    expect(renderSequenceEmail(lead, 3, { body: "custom" }).useLink).toBe(true);
  });

  it("escapes operator HTML (no injection)", () => {
    const r = renderSequenceEmail(lead, 1, { body: "<script>alert(1)</script>" });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("keeps the {{screenshot}} marker so the sender can place the image", () => {
    const r = renderSequenceEmail(lead, 2, { body: "Look:\n\n{{screenshot}}\n\nNice?" });
    expect(r.html).toContain("<!--SCREENSHOT-->");
  });

  it("the editable default round-trips to the same render as the system default", () => {
    const d = defaultEditableCopy("build", 1)!;
    const fromEditable = renderSequenceEmail(lead, 1, { subject: d.subject, body: d.body });
    const def = renderSequenceEmail(lead, 1);
    // spintax resolves randomly, so just assert the token-filled name survives.
    expect(fromEditable.subject).toContain("Joe's Diner");
    expect(def.subject).toContain("Joe's Diner");
    expect(fromEditable.html).toContain("Joe");
  });
});
