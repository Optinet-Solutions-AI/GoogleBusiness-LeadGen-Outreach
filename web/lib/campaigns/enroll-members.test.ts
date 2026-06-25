import { describe, it, expect } from "vitest";
import { enrollableMemberIds } from "./enroll-members";

describe("enrollableMemberIds", () => {
  it("keeps leads that have an email and aren't already active", () => {
    const ids = enrollableMemberIds([
      { id: "1", email: "a@x.com", seq_status: null },
      { id: "2", email: null, seq_status: null },
      { id: "3", email: "c@x.com", seq_status: "active" },
    ]);
    expect(ids).toEqual(["1"]);
  });
});
