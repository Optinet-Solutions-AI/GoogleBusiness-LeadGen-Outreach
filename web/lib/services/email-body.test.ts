/**
 * email-body.test.ts — lock the shared plain-text and screenshot-placement helpers.
 *
 * Inputs:  hand-written email HTML
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { describe, expect, it } from "vitest";
import { htmlToText, newMessageId, placeScreenshot } from "./email-body";

describe("newMessageId", () => {
  it("uses the sender's domain", () => {
    expect(newMessageId("lucas@rateupdigital.com")).toMatch(/^<[a-z0-9]+-[a-z0-9]+@rateupdigital\.com>$/);
  });
});

describe("htmlToText", () => {
  it("turns paragraphs and line breaks into text and strips tags", () => {
    expect(htmlToText("<p>Hi <b>Joe</b>,</p><p>Line one<br>Line two</p>")).toBe("Hi Joe,\n\nLine one\nLine two");
  });
});

describe("placeScreenshot", () => {
  const img = '<img src="x.png">';
  it("puts the image at the marker", () => {
    expect(placeScreenshot("<p>a</p><!--SCREENSHOT--><p>b</p>", img)).toBe('<p>a</p><img src="x.png"><p>b</p>');
  });
  it("appends the image when there is no marker", () => {
    expect(placeScreenshot("<p>a</p>", img)).toBe('<p>a</p><br><img src="x.png">');
  });
});
