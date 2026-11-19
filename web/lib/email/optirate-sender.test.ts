/**
 * optirate-sender.test.ts — reputation emails default to the OptiRate mailbox with the most of today's allowance left.
 *
 * Inputs:  mailbox lists with today's sends and caps
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { pickOptiRateSender } from "./optirate-sender";

describe("pickOptiRateSender", () => {
  it("picks the OptiRate mailbox with the most room left today, never a non-OptiRate one", () => {
    expect(
      pickOptiRateSender([
        { email: "grace@rp.rateupdigital.com", sentToday: 0, cap: 50 },
        { email: "lily@rp.optiratesolutions.net", sentToday: 3, cap: 16 },
        { email: "ethan@rp.optiratessolutions.com", sentToday: 1, cap: 16 },
      ]),
    ).toBe("ethan@rp.optiratessolutions.com");
  });
  it("breaks a tie alphabetically (ethan before lily)", () => {
    expect(
      pickOptiRateSender([
        { email: "lily@rp.optiratesolutions.net", sentToday: 0, cap: 16 },
        { email: "ethan@rp.optiratessolutions.com", sentToday: 0, cap: 16 },
      ]),
    ).toBe("ethan@rp.optiratessolutions.com");
  });
  it("is null when no OptiRate mailbox is connected", () => {
    expect(pickOptiRateSender([{ email: "grace@rp.rateupdigital.com", sentToday: 0, cap: 50 }])).toBeNull();
    expect(pickOptiRateSender([])).toBeNull();
  });
});
