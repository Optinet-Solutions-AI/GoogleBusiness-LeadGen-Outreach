import { describe, it, expect } from "vitest";
import { selectSnapshot } from "@/lib/campaigns/select";

const lead = (id: string, created_at: string, lifecycle_stage = "prospect") =>
  ({ id, created_at, lifecycle_stage });

describe("selectSnapshot", () => {
  it("takes the newest N, excludes suppressed", () => {
    const cands = [
      lead("a", "2026-06-01T00:00:00Z"),
      lead("b", "2026-06-03T00:00:00Z"),
      lead("c", "2026-06-02T00:00:00Z"),
      lead("d", "2026-06-04T00:00:00Z", "dnc"),
      lead("e", "2026-06-05T00:00:00Z", "unsubscribed"),
    ];
    expect(selectSnapshot(cands, 2)).toEqual(["b", "c"]);
  });
  it("returns all eligible when target exceeds count", () => {
    expect(selectSnapshot([lead("a", "2026-06-01T00:00:00Z")], 10)).toEqual(["a"]);
  });
  it("target<=0 → empty", () => {
    expect(selectSnapshot([lead("a", "2026-06-01T00:00:00Z")], 0)).toEqual([]);
  });
});
