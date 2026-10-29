/**
 * prompt.test.ts — unit tests for extraction input trimming and user-prompt rendering.
 *
 * Inputs:  hand-built ExtractionInput fixtures
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, it, expect } from "vitest";
import { buildExtractionInput, renderUserPrompt, type ExtractionInput } from "./prompt";

const base: ExtractionInput = { intake: null, maps: null, pages: [], assets: [], language: null };
const page = (id: string, path: string, len: number, title: string | null = null) => ({
  id,
  url: `https://acme.test${path}`,
  title,
  text: "x".repeat(len),
});

describe("buildExtractionInput", () => {
  it("trims to budget and keeps home + about whole before trimming later pages", () => {
    const raw = {
      ...base,
      pages: [page("p3", "/blog", 500), page("p2", "/about", 300), page("p1", "/", 400), page("p4", "/contact", 500)],
    };
    const out = buildExtractionInput(raw, 1000);
    expect(out.pages.map((p) => p.id)).toEqual(["p1", "p2", "p4"]);
    expect(out.pages[0].text.length).toBe(400);
    expect(out.pages[1].text.length).toBe(300);
    expect(out.pages[2].text.length).toBe(300);
    expect(out.pages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(1000);
  });

  it("with zero pages and only intake is valid and renders the intake section", () => {
    const intake = {
      sells: "cakes", customers: "locals", tone: ["warm"], tone_note: "", always_mention: "",
      never_claim: "", cta_kind: "call" as const, cta_target: "555", other: "",
    };
    const out = buildExtractionInput({ ...base, intake }, 1000);
    expect(out.pages).toEqual([]);
    const text = renderUserPrompt(out);
    expect(text).toContain("# OPERATOR INTAKE (authoritative)");
    expect(text).toContain("cakes");
  });
});

describe("renderUserPrompt", () => {
  it("omits empty sections", () => {
    const text = renderUserPrompt({ ...base, pages: [page("p1", "/", 10, "Home")] });
    expect(text).toContain("# PAGES");
    expect(text).toContain("## PAGE p1 https://acme.test/");
    expect(text).not.toContain("# OPERATOR INTAKE");
    expect(text).not.toContain("# GOOGLE MAPS");
    expect(text).not.toContain("# ASSETS");
  });
});
