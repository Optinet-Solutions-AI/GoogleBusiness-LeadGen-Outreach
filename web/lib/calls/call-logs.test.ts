/**
 * call-logs.test.ts — the Call logs filters read from the page's query string.
 *
 * Inputs:  URLSearchParams
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { parseCallLogFilters } from "./call-logs";

describe("parseCallLogFilters", () => {
  it("reads valid filters", () => {
    expect(parseCallLogFilters(new URLSearchParams("result=interested&test=1&page=2&from=2026-11-01&agent=default"))).toEqual({
      result: "interested",
      test: true,
      page: 2,
      from: "2026-11-01",
      agent: "default",
    });
  });
  it("drops invalid values, page defaults to 1", () => {
    expect(parseCallLogFilters(new URLSearchParams("result=bogus&page=-3&from=nope&to=2026-13-40"))).toEqual({ page: 1 });
  });
});
