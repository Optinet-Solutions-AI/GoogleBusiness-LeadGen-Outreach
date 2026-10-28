import { describe, expect, it } from "vitest";
import {
  compareValues,
  matchesSearch,
  nextSort,
  pageInfo,
  paginate,
  parseTableParams,
  sortRows,
} from "./table";

describe("compareValues", () => {
  it("orders numbers and strings in both directions", () => {
    expect(compareValues(1, 2, "asc")).toBeLessThan(0);
    expect(compareValues(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareValues("b", "a", "asc")).toBeGreaterThan(0);
  });
  it("compares strings naturally and case-insensitively", () => {
    expect(compareValues("item 2", "item 10", "asc")).toBeLessThan(0);
    expect(compareValues("Apple", "apple", "asc")).toBe(0);
  });
  it("puts empty values last regardless of direction", () => {
    expect(compareValues(null, 5, "asc")).toBeGreaterThan(0);
    expect(compareValues(null, 5, "desc")).toBeGreaterThan(0);
    expect(compareValues("", "x", "desc")).toBeGreaterThan(0);
  });
});

describe("sortRows", () => {
  it("is stable for equal keys", () => {
    const rows = [{ k: 1, id: "a" }, { k: 0, id: "b" }, { k: 1, id: "c" }];
    expect(sortRows(rows, (r) => r.k, "asc").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
});

describe("matchesSearch", () => {
  it("requires every word, in any order", () => {
    expect(matchesSearch("Houston Flooring Warehouse", "warehouse hou")).toBe(true);
    expect(matchesSearch("Houston Flooring Warehouse", "austin")).toBe(false);
    expect(matchesSearch("anything", "  ")).toBe(true);
  });
});

describe("nextSort", () => {
  it("cycles asc → desc → off, and restarts on a new column", () => {
    expect(nextSort(null, "a")).toEqual({ key: "a", dir: "asc" });
    expect(nextSort({ key: "a", dir: "asc" }, "a")).toEqual({ key: "a", dir: "desc" });
    expect(nextSort({ key: "a", dir: "desc" }, "a")).toBeNull();
    expect(nextSort({ key: "a", dir: "desc" }, "b")).toEqual({ key: "b", dir: "asc" });
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 53 }, (_, i) => i);
  it("slices a page and reports the range", () => {
    const p = paginate(rows, 2, 25);
    expect(p.rows[0]).toBe(25);
    expect(p).toMatchObject({ page: 2, pageCount: 3, total: 53, from: 26, to: 50 });
  });
  it("clamps an out-of-range page", () => {
    expect(paginate(rows, 99, 25).page).toBe(3);
    expect(paginate(rows, 0, 25).page).toBe(1);
  });
  it("handles an empty list", () => {
    expect(paginate([], 1, 25)).toMatchObject({ page: 1, pageCount: 1, total: 0, from: 0, to: 0 });
  });
});

describe("pageInfo", () => {
  it("computes the visible range for server paging", () => {
    expect(pageInfo(120, 3, 50)).toMatchObject({ page: 3, pageCount: 3, from: 101, to: 120 });
  });
});

describe("parseTableParams", () => {
  it("accepts only whitelisted sort keys", () => {
    expect(parseTableParams({ sort: "name", dir: "desc" }, ["name"]).sort).toEqual({ key: "name", dir: "desc" });
    expect(parseTableParams({ sort: "password" }, ["name"]).sort).toBeNull();
  });
  it("defaults and caps page + per", () => {
    expect(parseTableParams({}, [])).toEqual({ sort: null, page: 1, per: 50 });
    expect(parseTableParams({ page: "-3", per: "5000" }, [], { maxPer: 200 })).toEqual({ sort: null, page: 1, per: 200 });
    expect(parseTableParams({ page: "4", per: "25" }, [])).toMatchObject({ page: 4, per: 25 });
  });
});
