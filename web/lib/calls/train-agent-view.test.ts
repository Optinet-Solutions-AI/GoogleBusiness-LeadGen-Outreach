/**
 * train-agent-view.test.ts — "Train a voice agent": the request shape, plain error sentences and before/after lines.
 *
 * Inputs:  plain values (no network)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { asLines, clipHistory, groupEdits, splitHeadsUp, trainErrorText, trainRequest } from "./train-agent-view";

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
  it("says nothing was changed when Voizo couldn't update the live agent", () =>
    expect(trainErrorText("provision_failed")).toMatch(/nothing was changed/));
  it("adds Voizo's plain detail to a stale suggestion and an undo conflict", () => {
    expect(trainErrorText("stale_proposal", "x", { detail: "The opening line was edited" })).toMatch(/Ask again\. The opening line was edited\.$/);
    expect(trainErrorText("undo_conflict", "x", { detail: "The price answer changed again." })).toMatch(/first\. The price answer changed again\.$/);
  });
  it("names the daily limit when Voizo sends it", () =>
    expect(trainErrorText("rate_limited", "x", { cap: 40 })).toMatch(/40 training requests/));
});

describe("asLines", () => {
  it("one line for a string", () => expect(asLines("  Hi {{playerName}}  ")).toEqual(["Hi {{playerName}}"]));
  it("one line per statement, blanks dropped", () => expect(asLines(["a", " ", "b"])).toEqual(["a", "b"]));
  it("an emptied box reads as nothing said", () => {
    expect(asLines([])).toEqual(["(nothing said here)"]);
    expect(asLines("")).toEqual(["(nothing said here)"]);
  });
});

describe("asLines with a line that has two versions (with / without a name)", () => {
  it("shows each version on its own line, with no template code", () =>
    expect(asLines('{% if playername != blank and playername != "-" %}Hi {{playername}}, Lucas here{% else %}Hey, Lucas here{% endif %}')).toEqual([
      "Hi {{playername}}, Lucas here",
      "Hey, Lucas here",
    ]));
  it("keeps the words around the two versions", () =>
    expect(asLines("Thanks{% if city != blank %} for being in {{city}}{% endif %}, talk soon")).toEqual(["Thanks for being in {{city}}, talk soon", "Thanks, talk soon"]));
});

describe("groupEdits", () => {
  const same = { before: "It's Lucas, calling from RateUp.", after: "It's Lucas, calling from RateUp, a small web studio." };
  it("shows one answer once when it is used in many parts of the call", () =>
    expect(
      groupEdits([
        { label: 'Name check — "Owner asks who is calling."', ...same },
        { label: 'The pitch — "Owner asks who is calling."', ...same },
        { label: 'The pitch — "Owner asks who is calling."', ...same },
      ]),
    ).toEqual([{ title: "Owner asks who is calling.", places: ["Name check", "The pitch"], ...same }]));
  it("keeps different changes apart, each under its own label", () =>
    expect(groupEdits([{ label: "Opener", before: "a", after: "b" }, { label: "Close", before: "c", after: "d" }])).toEqual([
      { title: "Opener", places: [], before: "a", after: "b" },
      { title: "Close", places: [], before: "c", after: "d" },
    ]));
});

describe("splitHeadsUp", () => {
  it("pulls Voizo's shared-answer warning out of the reply", () =>
    expect(splitHeadsUp("I updated the caller lines. Heads up: that answer is shared by all the offers, so this changes it for every one of them.")).toEqual({
      text: "I updated the caller lines.",
      warning: "That answer is shared by all the offers, so this changes it for every one of them.",
    }));
  it("leaves an ordinary reply alone", () => expect(splitHeadsUp("Done.")).toEqual({ text: "Done.", warning: null }));
});

describe("trainErrorText for a suggestion or change that is already used up", () => {
  it("doesn't claim the script changed when the suggestion was simply saved already or expired", () =>
    expect(trainErrorText("stale_proposal")).toMatch(/already saved, is over 30 minutes old, or the script changed since this suggestion/));
  it("doesn't tell the operator to undo a newer change when this one was already undone", () =>
    expect(trainErrorText("undo_conflict")).toMatch(/already undone, or a newer change/));
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
