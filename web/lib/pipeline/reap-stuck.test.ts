import { describe, it, expect } from "vitest";
import { isBatchStuck, STALE_MS, type ReapableBatch } from "@/lib/pipeline/reap-stuck";

const NOW = new Date("2026-07-01T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function batch(over: Partial<ReapableBatch>): ReapableBatch {
  return { id: "b1", status: "running", heartbeat_at: null, updated_at: null, created_at: null, ...over };
}

describe("isBatchStuck", () => {
  it("reaps a running batch whose heartbeat is older than STALE_MS", () => {
    expect(isBatchStuck(batch({ heartbeat_at: ago(STALE_MS + 1000) }), NOW)).toBe(true);
  });

  it("keeps a running batch with a fresh heartbeat", () => {
    expect(isBatchStuck(batch({ heartbeat_at: ago(10_000) }), NOW)).toBe(false);
  });

  it("never reaps a batch that is not running", () => {
    expect(isBatchStuck(batch({ status: "done", heartbeat_at: ago(STALE_MS * 10) }), NOW)).toBe(false);
    expect(isBatchStuck(batch({ status: "failed", heartbeat_at: ago(STALE_MS * 10) }), NOW)).toBe(false);
    expect(isBatchStuck(batch({ status: "queued", heartbeat_at: ago(STALE_MS * 10) }), NOW)).toBe(false);
  });

  it("falls back to updated_at when heartbeat_at is null (legacy rows / pre-heartbeat)", () => {
    expect(isBatchStuck(batch({ updated_at: ago(STALE_MS + 1000) }), NOW)).toBe(true);
    expect(isBatchStuck(batch({ updated_at: ago(30_000) }), NOW)).toBe(false);
  });

  it("prefers heartbeat_at over updated_at when both present", () => {
    // stale updated_at but fresh heartbeat → still alive, don't reap
    expect(
      isBatchStuck(batch({ heartbeat_at: ago(5_000), updated_at: ago(STALE_MS * 5) }), NOW),
    ).toBe(false);
  });

  it("fails safe: never reaps when no timestamp is available", () => {
    expect(isBatchStuck(batch({}), NOW)).toBe(false);
  });

  it("ignores an unparseable timestamp rather than reaping", () => {
    expect(isBatchStuck(batch({ heartbeat_at: "not-a-date" }), NOW)).toBe(false);
  });
});
