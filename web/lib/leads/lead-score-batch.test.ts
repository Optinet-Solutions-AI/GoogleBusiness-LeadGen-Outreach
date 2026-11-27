import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/services/openai-brain", () => ({
  brainJson: vi.fn(),
  BrainError: class BrainError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));

import { BrainError } from "@/lib/services/openai-brain";
import { claimBatchScoring, scoreBatch } from "./lead-score-batch";
import type { LeadScore, ScoreLead } from "./lead-score";

const SCORE: LeadScore = { score: 50, band: "warm", reasons: ["a"], holding_back: "b", model: "m", usd: 0.004, scored_at: "t" };
const leads = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `L${i}` }) as ScoreLead);

describe("scoreBatch", () => {
  it("scores up to the cap and totals the cost", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const r = await scoreBatch("B", { cap: 5, load: async () => leads(7), score: async () => SCORE, save });
    expect(r).toEqual({ scored: 5, failed: 0, usd: 0.02 });
    expect(save).toHaveBeenCalledTimes(5);
    expect(save).toHaveBeenCalledWith("L0", SCORE);
  });

  it("never runs more than 4 at a time", async () => {
    let live = 0;
    let most = 0;
    const score = async () => {
      live++;
      most = Math.max(most, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return SCORE;
    };
    await scoreBatch("B", { cap: 20, load: async () => leads(12), score, save: async () => undefined });
    expect(most).toBeLessThanOrEqual(4);
  });

  it("stops at a dead key, counts unusable answers as failed", async () => {
    let n = 0;
    const score = vi.fn(async () => {
      n++;
      if (n === 1) return null;
      throw new BrainError("no_credit", "x");
    });
    const r = await scoreBatch("B", { cap: 10, load: async () => leads(30), save: vi.fn(), score });
    expect(r.scored).toBe(0);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(score.mock.calls.length).toBeLessThan(30);
  });
});

describe("claimBatchScoring (review fix: atomic, fails closed)", () => {
  const NOW = new Date("2026-12-01T10:00:00Z");
  it("the first press claims; a second one at the same time is refused", async () => {
    expect(await claimBatchScoring("B", NOW, { insert: async () => true, takeOver: async () => false })).toEqual({ ok: true });
    expect(await claimBatchScoring("B", NOW, { insert: async () => false, takeOver: async () => false })).toEqual({ ok: false });
  });
  it("a claim older than 15 minutes is taken over", async () => {
    const takeOver = vi.fn(async () => true);
    expect(await claimBatchScoring("B", NOW, { insert: async () => false, takeOver })).toEqual({ ok: true });
    expect(takeOver).toHaveBeenCalledWith("score_batch:B", NOW.toISOString(), "2026-12-01T09:45:00.000Z");
  });
  it("a database error refuses (never two paid runs)", async () => {
    expect(await claimBatchScoring("B", NOW, { insert: async () => { throw new Error("db down"); }, takeOver: async () => true })).toEqual({ ok: false });
  });
});
