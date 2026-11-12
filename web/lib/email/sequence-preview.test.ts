/**
 * sequence-preview.test.ts — the Send email preview shows exactly the words that get sent.
 *
 * Inputs:  sample leads, styles, campaign overrides
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { allSteps, displayBody, isEdited, stepCopy, stepDay } from "./sequence-preview";
import { htmlToPlain, renderSequenceEmail } from "./sequence-templates";

const build = { business_name: "Joe & Sons Plumbing", demo_url: "https://joe.pages.dev", call_segment: "no_website" };
const services = { business_name: "Bella Cucina", demo_url: null, call_segment: "has_website" };

describe("stepCopy", () => {
  it("fills the business name and picks one wording variant (no braces left)", () => {
    const c = stepCopy(build, 1)!;
    expect(c.subject).toBe("A quick idea for Joe & Sons Plumbing");
    expect(c.body).toContain("Joe & Sons Plumbing");
    expect(c.body).not.toMatch(/[{}|]/);
  });
  it("keeps the link and screenshot tokens for the sender to swap in", () => {
    expect(stepCopy(build, 2)!.body).toContain("{{screenshot}}");
    expect(stepCopy(build, 3)!.body).toContain("{{demo_link}}");
  });
  it("uses the campaign's own wording when it has one, default for blank fields", () => {
    const c = stepCopy(build, 1, "friendly", { subject: "Hello {{business_name}}", body: "  " })!;
    expect(c.subject).toBe("Hello Joe & Sons Plumbing");
    expect(c.body).toContain("I'm Sam from RateUp");
  });
  it("returns null past the last step of the pitch", () => {
    expect(stepCopy(services, 3)).toBeNull();
  });
});

describe("allSteps", () => {
  it("lists 4 emails 4 days apart for a demo-site pitch, 2 for AI services", () => {
    expect(allSteps(build).map((s) => s.day)).toEqual([0, 4, 8, 12]);
    expect(allSteps(services).map((s) => s.step)).toEqual([1, 2]);
    expect(stepDay(3)).toBe(8);
  });
});

describe("approved wording round-trips through the sender unchanged", () => {
  it("renders the approved text, and reading it back gives the same text", () => {
    const approved = stepCopy(build, 1)!;
    const sent = renderSequenceEmail(build, 1, approved);
    expect(sent.subject).toBe(approved.subject);
    expect(htmlToPlain(sent.html)).toBe(approved.body);
  });
});

describe("display helpers", () => {
  it("shows tokens as what they become", () => {
    expect(displayBody("See {{demo_link}}", "https://x.dev")).toBe("See https://x.dev");
    expect(displayBody("{{screenshot}}", null)).toContain("screenshot");
  });
  it("ignores whitespace-only edits", () => {
    const a = { subject: "Hi", body: "One\n\nTwo" };
    expect(isEdited(a, { subject: "Hi ", body: "One\n\n Two" })).toBe(false);
    expect(isEdited(a, { subject: "Hi", body: "One\n\nThree" })).toBe(true);
  });
});

describe("allSteps with no demo built yet", () => {
  it("shows the 2-step free-sample offer, day 0 and day 4", () => {
    const steps = allSteps({ business_name: "Joe & Sons Plumbing", demo_url: null, call_segment: "no_website", no_demo: true });
    expect(steps.map((s) => [s.step, s.day])).toEqual([[1, 0], [2, 4]]);
    expect(steps[0].copy.body).toMatch(/free sample/);
    expect(steps[0].copy.body).toContain("Joe & Sons Plumbing");
    expect(steps.some((s) => /\{\{\s*(screenshot|demo_link)\s*\}\}/.test(s.copy.body))).toBe(false);
  });

  it("matches what the scheduler sends for step 1", () => {
    const lead = { business_name: "Joe & Sons Plumbing", demo_url: null, call_segment: "old_website", no_demo: true };
    const shown = allSteps(lead)[0].copy.subject;
    expect(renderSequenceEmail(lead, 1).subject).toBe(shown);
  });
});
