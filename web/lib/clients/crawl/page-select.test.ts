/**
 * page-select.test.ts — Unit tests for crawl link selection and prompt page ranking.
 *
 * Inputs:  inline HTML fixtures
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */

import { describe, expect, it } from "vitest";
import { pickCrawlLinks, rankPagesForPrompt } from "./page-select";

describe("pickCrawlLinks", () => {
  it("keeps www/apex and http/https variants, drops other hosts, files, mailto, hash/query duplicates, and puts keyword links first", () => {
    const html = `
      <a href="/team-photo-day">Random</a>
      <a href="https://www.example.com/blog">Blog</a>
      <a href="http://example.com/about#top">Who we are</a>
      <a href="http://example.com/about?ref=nav">About again</a>
      <a href="https://other.com/services">External</a>
      <a href="/brochure.pdf">Brochure</a>
      <a href="/logo.PNG">Logo</a>
      <a href="mailto:a@example.com">Mail</a>
      <a href="tel:+15551234">Call</a>
      <a href="/">Home</a>
      <a href="https://example.com">Home again</a>
      <a href="/our-services">Our Services</a>
      <a href="/pricing/">Plans</a>
      <a href="/misc">Pricing info</a>`;
    const out = pickCrawlLinks(html, "https://example.com/", 20);
    expect(out).toEqual([
      "http://example.com/about",
      "https://example.com/our-services",
      "https://example.com/pricing/",
      "https://example.com/misc",
      "https://example.com/team-photo-day",
      "https://www.example.com/blog",
    ]);
  });

  it("resolves relative links against a nested base url", () => {
    const out = pickCrawlLinks(`<a href="contact">C</a>`, "https://example.com/en/", 5);
    expect(out).toEqual(["https://example.com/en/contact"]);
  });

  it("returns at most max-1 links", () => {
    const html = Array.from({ length: 10 }, (_, i) => `<a href="/p${i}">P${i}</a>`).join("");
    expect(pickCrawlLinks(html, "https://example.com/", 4)).toHaveLength(3);
    expect(pickCrawlLinks(html, "https://example.com/", 1)).toEqual([]);
  });
});

describe("rankPagesForPrompt", () => {
  it("orders home, about, services, pricing, contact, rest", () => {
    const pages = [
      { url: "https://example.com/blog", title: "Blog" },
      { url: "https://example.com/contact", title: "Contact us" },
      { url: "https://example.com/pricing", title: "Plans" },
      { url: "https://example.com/menu", title: "Our menu" },
      { url: "https://example.com/about-us", title: "About" },
      { url: "https://example.com/", title: "Home" },
      { url: "https://example.com/faq", title: "FAQ" },
    ];
    expect(rankPagesForPrompt(pages).map((p) => p.url)).toEqual([
      "https://example.com/",
      "https://example.com/about-us",
      "https://example.com/menu",
      "https://example.com/pricing",
      "https://example.com/contact",
      "https://example.com/blog",
      "https://example.com/faq",
    ]);
  });

  it("falls back to the first page as home when none has a root path", () => {
    const pages = [
      { url: "https://example.com/en/x", title: null },
      { url: "https://example.com/about", title: null },
    ];
    expect(rankPagesForPrompt(pages)[0].url).toBe("https://example.com/en/x");
  });
});
