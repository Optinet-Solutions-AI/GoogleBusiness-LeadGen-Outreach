/**
 * strip-dashes.test.ts — site/outreach copy must never contain em/en dashes.
 */
import { describe, it, expect } from "vitest";
import { stripFancyDashes } from "./gemini";

describe("stripFancyDashes", () => {
  it("replaces an em dash with a comma", () => {
    expect(stripFancyDashes("Plumbing and HVAC — done right")).toBe("Plumbing and HVAC, done right");
  });
  it("replaces an en dash", () => {
    expect(stripFancyDashes("Open 9–5 daily")).toBe("Open 9, 5 daily");
  });
  it("collapses doubled commas/spaces it would create", () => {
    expect(stripFancyDashes("One service, — fast")).toBe("One service, fast");
  });
  it("leaves clean copy and hyphens untouched", () => {
    expect(stripFancyDashes("Family-owned, fast service")).toBe("Family-owned, fast service");
  });
});
