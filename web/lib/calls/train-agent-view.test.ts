/**
 * train-agent-view.test.ts — "Train a voice agent": the request shape, plain error sentences and before/after lines.
 *
 * Inputs:  plain values (no network)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { asLines, clipHistory, trainErrorText, trainRequest } from "./train-agent-view";

describe("trainRequest", () => {
  it("accepts a question with history", () =>
    expect(
      trainRequest.safeParse({ action: "ask", campaignId: "c1", message: "Don't mention price", history: [{ role: "user", text: "hi" }] }).success,
    ).toBe(true));
  it("rejects an empty question with a plain sentence", () => {
    const r = trainRequest.safeParse({ action: "ask", campaignId: "c1", message: "   " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Say or type what to change first");
  });
  it("accepts apply and undo", () => {
    expect(trainRequest.safeParse({ action: "apply", campaignId: "c1", proposalId: "p1" }).success).toBe(true);
    expect(trainRequest.safeParse({ action: "undo", campaignId: "c1", changeId: "ch1" }).success).toBe(true);
  });
  it("rejects an unknown action and a missing agent", () => {
    expect(trainRequest.safeParse({ action: "rewrite", campaignId: "c1" }).success).toBe(false);
    expect(trainRequest.safeParse({ action: "apply", proposalId: "p1" }).success).toBe(false);
  });
});

describe("trainErrorText", () => {
  it("says training isn't switched on when Voizo has no such endpoint yet", () =>
    expect(trainErrorText("http_404")).toMatch(/isn't switched on in Voizo yet/));
  it("explains a stale suggestion", () => expect(trainErrorText("stale_proposal")).toMatch(/changed since this suggestion/));
  it("explains an undo conflict", () => expect(trainErrorText("undo_conflict")).toMatch(/newer change/));
  it("uses Voizo's own sentence for a bad request", () =>
    expect(trainErrorText("bad_request", "instruction is too long.")).toBe("instruction is too long."));
  it("never shows a raw code", () => expect(trainErrorText("weird_code")).not.toMatch(/weird_code/));
});

describe("asLines", () => {
  it("one line for a string", () => expect(asLines("  Hi {{playerName}}  ")).toEqual(["Hi {{playerName}}"]));
  it("one line per statement, blanks dropped", () => expect(asLines(["a", " ", "b"])).toEqual(["a", "b"]));
  it("an emptied box reads as nothing said", () => {
    expect(asLines([])).toEqual(["(nothing said here)"]);
    expect(asLines("")).toEqual(["(nothing said here)"]);
  });
});

describe("clipHistory", () => {
  it("keeps the last 10 turns, each at most 1000 characters", () => {
    const turns = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), text: `t${i}` }));
    const out = clipHistory([...turns, { role: "user", text: "x".repeat(1500) }]);
    expect(out).toHaveLength(10);
    expect(out[0].text).toBe("t5");
    expect(out[9].text).toHaveLength(1000);
  });
  it("drops empty turns", () => expect(clipHistory([{ role: "user", text: "  " }])).toEqual([]));
});
