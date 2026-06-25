import { describe, it, expect } from "vitest";
import { pickSender } from "./sender-rotation";

describe("pickSender", () => {
  const pool = [
    { email: "a@x.com", remaining: 5 },
    { email: "b@x.com", remaining: 5 },
    { email: "c@x.com", remaining: 5 },
  ];

  it("returns null for an empty pool", () => {
    expect(pickSender([], "lead1")).toBeNull();
  });

  it("returns null when every mailbox is capped", () => {
    expect(pickSender(pool.map((s) => ({ ...s, remaining: 0 })), "lead1")).toBeNull();
  });

  it("is deterministic for the same lead", () => {
    expect(pickSender(pool, "lead-abc")).toBe(pickSender(pool, "lead-abc"));
  });

  it("spreads different leads across mailboxes", () => {
    const picks = new Set(
      ["l1", "l2", "l3", "l4", "l5", "l6"].map((id) => pickSender(pool, id)),
    );
    // With 3 open mailboxes and 6 leads, we expect more than one distinct mailbox used.
    expect(picks.size).toBeGreaterThan(1);
  });

  it("never picks a capped mailbox", () => {
    const mixed = [
      { email: "full@x.com", remaining: 0 },
      { email: "open@x.com", remaining: 3 },
    ];
    for (const id of ["a", "b", "c", "d"]) {
      expect(pickSender(mixed, id)).toBe("open@x.com");
    }
  });
});
