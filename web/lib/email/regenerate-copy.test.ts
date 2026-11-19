/**
 * regenerate-copy.test.ts — an AI rewrite is only used when it's clean: no dashes, no spam words, links kept.
 *
 * Inputs:  sample rewrites
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/services/gemini", () => ({ rewriteOutreachEmail: vi.fn() }));

import { cleanRewrite } from "./regenerate-copy";

const original = { subject: "A website for Acme", body: "Hi Joe,\n\nHere's a sample: https://acme.pages.dev\n\nThanks", followUps: ["Following up.", ""] };

describe("cleanRewrite", () => {
  it("keeps a good rewrite, swapping long dashes for commas", () => {
    const out = cleanRewrite(original, { subject: "Acme — a quick idea", body: "Hi Joe,\n\nI made this — https://acme.pages.dev\n\nThanks", followUps: ["Just checking in.", ""] });
    expect(out).toEqual({ subject: "Acme, a quick idea", body: "Hi Joe,\n\nI made this, https://acme.pages.dev\n\nThanks", followUps: ["Just checking in.", ""] });
  });
  it("rejects a rewrite that drops a link from the original", () => {
    expect(cleanRewrite(original, { subject: "Hi", body: "Hi Joe, I made a sample.", followUps: ["", ""] })).toBeNull();
  });
  it("rejects spam words the template avoids", () => {
    expect(cleanRewrite(original, { subject: "Free website", body: "Free sample https://acme.pages.dev", followUps: ["", ""] })).toBeNull();
    expect(cleanRewrite(original, { subject: "Hi", body: "Guaranteed results https://acme.pages.dev", followUps: ["", ""] })).toBeNull();
  });
  it("rejects an empty or malformed answer", () => {
    expect(cleanRewrite(original, null)).toBeNull();
    expect(cleanRewrite(original, { subject: "", body: "x https://acme.pages.dev", followUps: [] })).toBeNull();
  });
});
