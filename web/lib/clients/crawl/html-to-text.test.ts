/**
 * html-to-text.test.ts — Unit tests for htmlToText (HTML to readable text).
 *
 * Inputs:  inline HTML fixtures
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */

import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-to-text";

describe("htmlToText", () => {
  it("strips chrome and keeps headings, paragraphs, list items and prices", () => {
    const html = `<html><head><title>Joe &amp; Sons Plumbing</title>
      <style>.x{color:red}</style><script>var secret = 1;</script></head>
      <body>
      <header><a href="/">LOGOHEADER</a></header>
      <nav><ul><li>NAVITEM</li></ul></nav>
      <h1>Fast  Plumbing</h1>
      <p>We fix   leaks &amp; pipes.</p>
      <ul><li>Drain cleaning</li><li>Water heaters</li></ul>
      <table><tr><td>Basic plan</td><td>$49/mo</td></tr></table>
      <noscript>NOSCRIPTTEXT</noscript><svg><text>SVGTEXT</text></svg>
      <footer>FOOTERTEXT</footer>
      </body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("Joe & Sons Plumbing");
    expect(text).toContain("Fast Plumbing");
    expect(text).toContain("We fix leaks & pipes.");
    expect(text).toContain("- Drain cleaning");
    expect(text).toContain("- Water heaters");
    expect(text).toContain("$49/mo");
    expect(text).toContain("Basic plan");
    for (const gone of ["NAVITEM", "LOGOHEADER", "FOOTERTEXT", "secret", "color:red", "NOSCRIPTTEXT", "SVGTEXT"]) {
      expect(text).not.toContain(gone);
    }
    expect(text.split("\n")).toContain("Fast Plumbing");
  });

  it("returns null title when absent and caps output at 200,000 chars", () => {
    const { title, text } = htmlToText(`<p>${"a ".repeat(300_000)}</p>`);
    expect(title).toBeNull();
    expect(text.length).toBeLessThanOrEqual(200_000);
  });

  it("stays fast on pathological unclosed markup", () => {
    const start = Date.now();
    htmlToText("<script>".repeat(50_000) + "<" .repeat(50_000));
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
