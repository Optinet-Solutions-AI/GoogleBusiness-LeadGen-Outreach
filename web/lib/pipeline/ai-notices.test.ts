/**
 * ai-notices.test.ts — the batch warnings about AI research read right in each case.
 *
 * Inputs:  AiRun tallies
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { aiNotices, mergeNotices, newAiRun } from "./ai-notices";

describe("aiNotices", () => {
  it("says nothing when AI covered every lead", () => {
    expect(aiNotices({ ...newAiRun(100), used: 40 }, 100)).toEqual([]);
  });

  it("warns when AI was off from the start, with the reason", () => {
    const [n] = aiNotices({ ...newAiRun(100), unavailable: "key_invalid" }, 100);
    expect(n.level).toBe("warning");
    expect(n.text).toMatch(/AI research was off for this batch: the OpenAI key was refused/);
    expect(n.text).toMatch(/free website crawl only/);
  });

  it("warns when AI stopped mid-batch", () => {
    const [n] = aiNotices({ ...newAiRun(100), used: 23, stoppedAt: "no_credit" }, 100);
    expect(n.text).toBe(
      "AI research stopped after 23 leads: the OpenAI account is out of credit. The rest were looked up with the free website crawl only — expect fewer emails and no owner names.",
    );
  });

  it("notes the per-batch limit", () => {
    const [n] = aiNotices({ ...newAiRun(100), used: 100, skippedByCap: 57 }, 100);
    expect(n.level).toBe("info");
    expect(n.text).toMatch(/first 100 leads .* The other 57/);
  });

  it("explains a limit of 0", () => {
    expect(aiNotices({ ...newAiRun(0), skippedByCap: 5 }, 0)[0].text).toMatch(/switched off in the settings/);
  });

  it("merges without repeating", () => {
    const a = { level: "info" as const, text: "x" };
    expect(mergeNotices([a], [a, { level: "warning", text: "y" }])).toEqual([a, { level: "warning", text: "y" }]);
    expect(mergeNotices(null, [a])).toEqual([a]);
  });
});
