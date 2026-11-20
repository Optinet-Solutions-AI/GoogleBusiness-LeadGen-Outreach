import { describe, expect, it } from "vitest";
import { formUsd, parseFillReply, parseResultReply } from "./contact-form-browser";

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
