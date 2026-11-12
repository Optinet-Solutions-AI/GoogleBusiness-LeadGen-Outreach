/**
 * when-text.test.ts — plain-English sending/calling hours.
 *
 * Inputs:  windows and instants
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { daysText, localTimeText, windowText } from "./when-text";

describe("when-text", () => {
  it("describes days the way people say them", () => {
    expect(daysText([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(daysText([1, 2, 3, 4, 5, 6, 7])).toBe("every day");
    expect(daysText([1, 3, 5])).toBe("Mon, Wed, Fri");
  });
  it("describes a window and a local time", () => {
    expect(windowText({ tz: "America/Chicago", days: [1, 2, 3, 4, 5], startHour: 9, endHour: 20 })).toBe("Mon–Fri, 9:00–20:00 (America/Chicago)");
    expect(localTimeText(new Date("2026-11-16T15:10:00Z"), "America/Chicago")).toBe("Mon 16 Nov, 9:10");
  });
});
