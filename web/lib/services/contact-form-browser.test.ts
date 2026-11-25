import { describe, expect, it } from "vitest";
import { formUsd, isChallengeText, parseFillReply, parseResultReply, runAction, type ActionGuard } from "./contact-form-browser";

describe("parseFillReply", () => {
  it("reads FILLED", () => expect(parseFillReply("FILLED")).toEqual({ kind: "filled", reason: null }));
  it("reads BLOCKED with its reason", () => expect(parseFillReply("blocked: captcha")).toEqual({ kind: "blocked", reason: "captcha" }));
  it("reads NO_FORM", () => expect(parseFillReply("NO_FORM")).toEqual({ kind: "no_form", reason: null }));
  it("treats anything else as blocked, so nothing is sent", () =>
    expect(parseFillReply("I think it's done")).toEqual({ kind: "blocked", reason: "The AI couldn't confirm the form was filled." }));
});

describe("parseResultReply", () => {
  it("reads SENT", () => expect(parseResultReply("SENT")).toEqual({ outcome: "sent", reason: null }));
  it("reads the page's error", () =>
    expect(parseResultReply("ERROR: Please enter a valid phone")).toEqual({ outcome: "failed", reason: "Please enter a valid phone" }));
  it("anything else is unknown", () => expect(parseResultReply("hmm")).toEqual({ outcome: "unknown", reason: null }));
});

describe("formUsd", () => {
  it("prices tokens per million", () =>
    expect(formUsd({ input_tokens: 1_000_000, output_tokens: 500_000 }, { inPerMTok: 3, outPerMTok: 12 })).toBe(9));
  it("rounds to 4 decimals", () =>
    expect(formUsd({ input_tokens: 12_345, output_tokens: 0 }, { inPerMTok: 3, outPerMTok: 12 })).toBe(0.037));
});

describe("strict AI replies (review finding 1)", () => {
  it("a FILLED word inside a sentence is not FILLED", () =>
    expect(parseFillReply("I filled what I could, but there's a CAPTCHA").kind).toBe("blocked"));
  it("reads the last line only", () => expect(parseFillReply("Closed the cookie banner.\nFILLED")).toEqual({ kind: "filled", reason: null }));
  it("lower-case filled is not enough", () => expect(parseFillReply("filled").kind).toBe("blocked"));
  it("'SENT — no error shown' is not a clean SENT", () => expect(parseResultReply("SENT — no error shown").outcome).toBe("unknown"));
  it("'may not have been sent' is unknown", () => expect(parseResultReply("It may not have been sent").outcome).toBe("unknown"));
  it("SENT on the last line counts", () => expect(parseResultReply("Thank-you message visible.\nSENT").outcome).toBe("sent"));
});

describe("runAction guard (review findings 2 and 6)", () => {
  function fakePage(focused: string) {
    const calls: string[] = [];
    const page = {
      mouse: {
        click: async () => void calls.push("click"),
        dblclick: async () => void calls.push("dblclick"),
        move: async () => {},
        wheel: async () => {},
        down: async () => {},
        up: async () => {},
      },
      keyboard: { type: async (t: string) => void calls.push(`type:${t}`), press: async (k: string) => void calls.push(`press:${k}`) },
      evaluate: async () => focused,
      waitForTimeout: async () => {},
    };
    return { page: page as unknown as Parameters<typeof runAction>[0], calls };
  }
  const guard = (phase: "fill" | "submit"): ActionGuard => ({ phase, host: null, submits: 0, blocked: 0, fillNote: "BLOCKED: fill" });

  it("a double-click while sending is ONE click", async () => {
    const { page, calls } = fakePage("other");
    const g = guard("submit");
    await runAction(page, { type: "double_click", x: 1, y: 1 }, g);
    expect(calls).toEqual(["click"]);
    expect(g.submits).toBe(1);
  });
  it("a second click while sending is refused", async () => {
    const { page, calls } = fakePage("other");
    const g = guard("submit");
    await runAction(page, { type: "click", x: 1, y: 1 }, g);
    const note = await runAction(page, { type: "click", x: 1, y: 1 }, g);
    expect(note).toMatch(/BLOCKED/);
    expect(calls).toEqual(["click"]);
  });
  it("Enter while filling is refused unless in a textarea", async () => {
    const onButton = fakePage("button");
    expect(await runAction(onButton.page, { type: "keypress", keys: ["ENTER"] }, guard("fill"))).toMatch(/BLOCKED/);
    expect(onButton.calls).toEqual([]);
    const inTextarea = fakePage("textarea");
    expect(await runAction(inTextarea.page, { type: "keypress", keys: ["ENTER"] }, guard("fill"))).toBeNull();
    expect(inTextarea.calls).toEqual(["press:Enter"]);
  });
  it("Space on a focused button while filling is refused", async () => {
    const { page, calls } = fakePage("button");
    expect(await runAction(page, { type: "keypress", keys: ["SPACE"] }, guard("fill"))).toMatch(/BLOCKED/);
    expect(calls).toEqual([]);
  });
  it("newlines typed into a one-line input are dropped", async () => {
    const { page, calls } = fakePage("input");
    await runAction(page, { type: "type", text: "Grace\n" }, guard("fill"));
    expect(calls).toEqual(["type:Grace"]);
  });
});

describe("a CAPTCHA that pops up after Send (Wix 'Please confirm you're human', 25 Nov 2026)", () => {
  it("the AI's CAPTCHA reply means blocked, not 'couldn't confirm'", () => {
    expect(parseResultReply("CAPTCHA")).toMatchObject({ outcome: "blocked" });
    expect(parseResultReply("Looks like a check.\nCAPTCHA")).toMatchObject({ outcome: "blocked" });
  });
  it("the challenge text Wix shows is recognised", () => {
    expect(isChallengeText("Verification\nPlease confirm you're human.\nI'm not a robot")).toBe(true);
    expect(isChallengeText("Thanks for submitting! We'll be in touch.")).toBe(false);
  });
});
