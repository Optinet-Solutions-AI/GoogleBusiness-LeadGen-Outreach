/**
 * format.test.ts — rendering the assistant's small-markdown safely.
 *
 * Inputs:  answer strings
 * Outputs: vitest assertions on the Block[] structure
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { isAppPath, parseAnswerBlocks, parseInline } from "./format";

describe("assistant answer format", () => {
  it("accepts only in-app paths as links", () => {
    expect(isAppPath("/leads")).toBe(true);
    expect(isAppPath("/leads?stage=deployed#top")).toBe(true);
    expect(isAppPath("//evil.com")).toBe(false);
    expect(isAppPath("https://evil.com")).toBe(false);
    expect(isAppPath("javascript:alert(1)")).toBe(false);
  });

  it("parses bold, code and links; outside links become plain text", () => {
    expect(parseInline("Click **Build website** on [Leads](/leads) or [x](https://evil.com) `id`")).toEqual([
      { t: "text", v: "Click " },
      { t: "b", v: "Build website" },
      { t: "text", v: " on " },
      { t: "link", v: "Leads", href: "/leads" },
      { t: "text", v: " or " },
      { t: "text", v: "x" },
      { t: "text", v: " " },
      { t: "code", v: "id" },
    ]);
  });

  it("groups numbered steps, bullets and paragraphs", () => {
    const blocks = parseAnswerBlocks("Do this:\n1. Open the batch\n2) Click a lead\n\n- tip one\n* tip two\n### Note\nDone.");
    expect(blocks.map((b) => [b.kind, b.items.length])).toEqual([
      ["p", 1],
      ["ol", 2],
      ["ul", 2],
      ["p", 2],
    ]);
    expect(blocks[3].items[0]).toEqual([{ t: "b", v: "Note" }]);
  });

  it("shows HTML as text, never markup", () => {
    expect(parseAnswerBlocks("<img src=x onerror=alert(1)>")[0].items[0]).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
  });
});
