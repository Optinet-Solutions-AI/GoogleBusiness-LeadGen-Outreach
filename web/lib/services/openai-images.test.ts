/**
 * openai-images.test.ts — pure tests for the background prompt builder and colour bucketing.
 *
 * Inputs:  brand descriptors
 * Outputs: assertions
 * Used by: vitest
 */
import { describe, expect, it } from "vitest";
import { backgroundPrompt, colourWord, NEGATIVE_LIST } from "./openai-images";

describe("backgroundPrompt", () => {
  const brand = { category: "HVAC contractor", tone: ["warm", "trustworthy"], colors: { primary: "#C50711", accent: "#1d4ed8" } };
  it("includes the negative list", () => {
    const p = backgroundPrompt(brand, "tip-quote");
    expect(p).toContain("no text, no letters, no logos, no faces, no product packaging, no watermarks");
    expect(p).toContain(NEGATIVE_LIST);
  });
  it("includes the category scene and colour words", () => {
    const p = backgroundPrompt(brand, "offer");
    expect(p).toContain("HVAC");
    expect(p).toContain("modern home interior");
    expect(p).toContain("red");
    expect(p).toContain("blue");
  });
  it("uses a kitchen scene for restaurants and tolerates missing colours", () => {
    const p = backgroundPrompt({ category: "Italian restaurant", tone: [], colors: { primary: null, accent: null } }, "tip-quote");
    expect(p).toContain("kitchen");
    expect(p).toContain("restrained colour palette");
  });
});

describe("colourWord", () => {
  it.each([
    ["#C50711", "red"],
    ["#f59e0b", "orange"],
    ["#eab308", "yellow"],
    ["#16a34a", "green"],
    ["#2563eb", "blue"],
    ["#7c3aed", "purple"],
    ["#888888", "neutral"],
  ])("%s -> %s", (hex, word) => expect(colourWord(hex)).toBe(word));
  it("returns null for junk", () => expect(colourWord("nope")).toBeNull());
});
