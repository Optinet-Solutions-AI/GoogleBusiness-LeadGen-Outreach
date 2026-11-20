/**
 * batch-ai-lookup-setting.test.ts — the New batch form's "Run AI Lookup on every lead" box (on by default).
 *
 * Inputs:  batch settings objects
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { BatchSettingsSchema, batchAiCap } from "./batch-settings";
import { aiNotices, newAiRun } from "./pipeline/ai-notices";

describe("AI Lookup on every lead (batch setting)", () => {
  it("is on by default, including old batches saved without it", () => {
    expect(BatchSettingsSchema.parse({}).ai_lookup).toBe(true);
    expect(batchAiCap(100, {})).toBe(100);
    expect(batchAiCap(100, null)).toBe(100);
  });
  it("unticked = no AI Lookup for that batch", () => {
    expect(BatchSettingsSchema.parse({ ai_lookup: false }).ai_lookup).toBe(false);
    expect(batchAiCap(100, { ai_lookup: false })).toBe(0);
  });
  it("the batch page says it was unticked and how to run it on one lead", () => {
    const [n] = aiNotices({ ...newAiRun(0), skippedByCap: 5 }, 0, { unticked: true });
    expect(n).toEqual({
      level: "info",
      text: "AI Lookup was unticked for this batch, so leads only got the free website crawl. Press AI Lookup on a lead to run it there.",
    });
  });
});
