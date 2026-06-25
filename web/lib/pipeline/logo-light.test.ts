/**
 * logo-light.test.ts — locks light-logo detection for SVG logos.
 *
 * Regression: a real fetched SVG whose paths are filled white via a <style>
 * class (Adobe Illustrator export, e.g. First Class Auto Service) rendered
 * invisible on a light nav because node-vibrant cannot rasterize SVG, so the
 * recolor was skipped. Our generated monograms must NOT be recolored — they
 * always carry a dark element (chip or contrast-checked text) and are visible
 * as-is.
 */
import { describe, it, expect } from "vitest";
import { svgLooksLight } from "./html-template-render";
import { generateMonogramSvg } from "../services/monogram";

describe("svgLooksLight", () => {
  it("flags an all-white SVG (fill via <style> class) as light", () => {
    const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 203 35">
<style type="text/css">.st0{fill:#FFFFFF;}</style>
<g><path class="st0" d="M0,6.7h5.8v8.2z"/></g>
</svg>`;
    expect(svgLooksLight(svg)).toBe(true);
  });

  it("flags an all-white SVG (inline fill attribute) as light", () => {
    const svg = `<svg viewBox="0 0 100 20"><path fill="#fff" d="M0 0h10v10z"/></svg>`;
    expect(svgLooksLight(svg)).toBe(true);
  });

  it("does NOT flag a dark logo as light", () => {
    const svg = `<svg viewBox="0 0 100 20"><path fill="#1A1F26" d="M0 0h10v10z"/></svg>`;
    expect(svgLooksLight(svg)).toBe(false);
  });

  it("does NOT flag a generated monogram (orange chip) as light", () => {
    const svg = generateMonogramSvg({ business_name: "Stevie's Mobile Mechanic", brand_hex: "#ED7942" });
    expect(svgLooksLight(svg)).toBe(false);
  });

  it("does NOT flag a generated monogram with a LIGHT brand color (dark text) as light", () => {
    const svg = generateMonogramSvg({ business_name: "Radiant Smiles", brand_hex: "#F4E206" });
    expect(svgLooksLight(svg)).toBe(false);
  });

  it("treats an SVG with no solid fill as light (would vanish)", () => {
    const svg = `<svg viewBox="0 0 100 20"><path fill="none" stroke="none" d="M0 0h10z"/></svg>`;
    expect(svgLooksLight(svg)).toBe(true);
  });
});
