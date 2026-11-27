import { describe, expect, it, vi } from "vitest";
import { BATCH_STEPS, BRAIN_STEPS, brainProgress, progressAt, ProgressWriter, type Progress } from "./progress";

const NOW = new Date("2026-11-27T10:00:00Z");

describe("progressAt", () => {
  it("steps before the current one are done, the current one runs, later ones wait", () => {
    const p = progressAt(BATCH_STEPS, "check", "checking websites… 12 of 42", NOW, { done: 12, total: 42 });
    expect(p.steps.map((s) => s.state)).toEqual(["done", "running", "waiting"]);
    expect(p).toMatchObject({ current: "check", line: "checking websites… 12 of 42", done: 12, total: 42, at: NOW.toISOString() });
  });
  it("'finished' marks every step done", () => {
    expect(progressAt(BATCH_STEPS, "finished", "Finished: 30 leads", NOW).steps.every((s) => s.state === "done")).toBe(true);
  });
});

describe("brainProgress (what the Brain page shows)", () => {
  const batch: Progress = progressAt(BATCH_STEPS, "check", "checking websites… 3 of 10", NOW, { done: 3, total: 10 });
  it("while searching it follows the batch, under the Brain's steps", () => {
    const p = brainProgress("searching", batch, null, NOW)!;
    expect(p.steps.map((s) => [s.key, s.state])).toEqual([
      ["understand", "done"],
      ["search", "done"],
      ["check", "running"],
      ["judge", "waiting"],
      ["plan", "waiting"],
    ]);
    expect(p.line).toBe("checking websites… 3 of 10");
  });
  it("while planning it shows its own judging line", () => {
    const own = progressAt(BRAIN_STEPS, "judge", "judging Joe's Plumbing… 5 of 30", NOW, { done: 5, total: 30 });
    expect(brainProgress("planning", batch, own, NOW)!.line).toBe("judging Joe's Plumbing… 5 of 30");
  });
  it("searching before the batch reported anything: the search step runs", () => {
    const p = brainProgress("searching", null, null, NOW)!;
    expect(p.steps.find((s) => s.key === "search")!.state).toBe("running");
    expect(p.line).toBe("starting the search…");
  });
  it("planning before any lead is judged; nothing for other statuses", () => {
    expect(brainProgress("planning", null, null, NOW)!.steps.find((s) => s.key === "judge")!.state).toBe("running");
    expect(brainProgress("review", batch, null, NOW)).toBeNull();
  });
});

describe("ProgressWriter (at most one write every 2 seconds, never on the hot path)", () => {
  it("writes the first one, holds rapid updates, always writes a step change and the final flush", async () => {
    let t = 0;
    const write = vi.fn(async () => {});
    const w = new ProgressWriter(write, 2000, () => t);
    const p = (current: string, line: string) => progressAt(BATCH_STEPS, current, line, NOW);
    w.set(p("check", "1 of 10"));
    t = 500;
    w.set(p("check", "2 of 10"));
    t = 900;
    w.set(p("check", "3 of 10"));
    expect(write).toHaveBeenCalledTimes(1);
    t = 2600;
    w.set(p("check", "4 of 10"));
    expect(write).toHaveBeenCalledTimes(2);
    t = 2700;
    w.set(p("save", "saving…"));
    expect(write).toHaveBeenCalledTimes(3);
    t = 2800;
    w.set(p("save", "saving more…"));
    await w.flush();
    expect(write).toHaveBeenCalledTimes(4);
    expect((write.mock.calls[3] as unknown[])[0]).toMatchObject({ line: "saving more…" });
  });
  it("a failing write never throws into the caller", async () => {
    const w = new ProgressWriter(async () => { throw new Error("db down"); }, 0, () => 0);
    expect(() => w.set(progressAt(BATCH_STEPS, "search", "x", NOW))).not.toThrow();
    await expect(w.flush()).resolves.toBeUndefined();
  });
});
