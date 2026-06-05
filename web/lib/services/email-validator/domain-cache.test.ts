/**
 * domain-cache.test.ts — unit tests for the isFresh freshness predicate
 *
 * Inputs:  fixed timestamps
 * Outputs: boolean assertions
 * Used by: vitest
 */
import { describe, it, expect } from "vitest";
import { isFresh } from "./domain-cache";

describe("isFresh", () => {
  const now = Date.parse("2026-06-05T00:00:00Z");
  it("fresh within 7 days", () => {
    expect(isFresh("2026-06-01T00:00:00Z", now)).toBe(true);
  });
  it("stale past 7 days", () => {
    expect(isFresh("2026-05-20T00:00:00Z", now)).toBe(false);
  });
});
