import { describe, it, expect } from "vitest";
import { classifyReachability, buildVerdict } from "@/lib/services/website-auditor";

describe("classifyReachability", () => {
  it("2xx → reachable", () => {
    expect(classifyReachability({ kind: "http", statusCode: 200 })).toEqual({ reachability: "reachable", status: "200" });
  });
  it("3xx → reachable", () => {
    expect(classifyReachability({ kind: "http", statusCode: 301 })).toEqual({ reachability: "reachable", status: "301" });
  });
  it("404 → dead", () => {
    expect(classifyReachability({ kind: "http", statusCode: 404 })).toEqual({ reachability: "dead", status: "404" });
  });
  it("410 → dead", () => {
    expect(classifyReachability({ kind: "http", statusCode: 410 })).toEqual({ reachability: "dead", status: "410" });
  });
  it("503 → dead", () => {
    expect(classifyReachability({ kind: "http", statusCode: 503 })).toEqual({ reachability: "dead", status: "503" });
  });
  it("403 → blocked", () => {
    expect(classifyReachability({ kind: "http", statusCode: 403 })).toEqual({ reachability: "blocked", status: "403 blocked" });
  });
  it("429 → blocked", () => {
    expect(classifyReachability({ kind: "http", statusCode: 429 })).toEqual({ reachability: "blocked", status: "429 blocked" });
  });
  it("other 4xx (400) → unverified", () => {
    expect(classifyReachability({ kind: "http", statusCode: 400 })).toEqual({ reachability: "unverified", status: "400" });
  });
  it("timeout → unverified", () => {
    expect(classifyReachability({ kind: "error", error: "timeout" })).toEqual({ reachability: "unverified", status: "timeout" });
  });
  it("dns_error → dead", () => {
    expect(classifyReachability({ kind: "error", error: "dns_error" })).toEqual({ reachability: "dead", status: "dns_error" });
  });
  it("conn_refused → dead", () => {
    expect(classifyReachability({ kind: "error", error: "conn_refused" })).toEqual({ reachability: "dead", status: "conn_refused" });
  });
  it("unknown error → unverified", () => {
    expect(classifyReachability({ kind: "error", error: "unknown" })).toEqual({ reachability: "unverified", status: "error" });
  });
  it("399 → reachable (upper boundary)", () => {
    expect(classifyReachability({ kind: "http", statusCode: 399 })).toEqual({ reachability: "reachable", status: "399" });
  });
  it("500 → dead (lower 5xx boundary)", () => {
    expect(classifyReachability({ kind: "http", statusCode: 500 })).toEqual({ reachability: "dead", status: "500" });
  });
});

describe("buildVerdict", () => {
  it("reachable + no issues → healthy, score 100, not improve", () => {
    const v = buildVerdict({ reachability: "reachable", status: "200", contentIssues: [], isDiyBuilder: false });
    expect(v).toEqual({ score: 100, issues: [], needs_improvement: false, reachability: "reachable", status: "200", parked: false });
  });
  it("reachable + no_https → improve (auto-flag) even though score 75", () => {
    const v = buildVerdict({ reachability: "reachable", status: "200", contentIssues: ["no_https"], isDiyBuilder: false });
    expect(v.score).toBe(75);
    expect(v.needs_improvement).toBe(true);
  });
  it("reachable + two issues under threshold → improve", () => {
    const v = buildVerdict({ reachability: "reachable", status: "200", contentIssues: ["not_mobile", "diy_builder"], isDiyBuilder: true });
    expect(v.score).toBe(55);
    expect(v.needs_improvement).toBe(true);
  });
  it("dead → score 0, improve, no content issues", () => {
    const v = buildVerdict({ reachability: "dead", status: "404", contentIssues: [], isDiyBuilder: false });
    expect(v).toEqual({ score: 0, issues: [], needs_improvement: true, reachability: "dead", status: "404", parked: false });
  });
  it("blocked, not diy → unknown (null), score null, not improve", () => {
    const v = buildVerdict({ reachability: "blocked", status: "403 blocked", contentIssues: [], isDiyBuilder: false });
    expect(v).toEqual({ score: null, issues: [], needs_improvement: null, reachability: "blocked", status: "403 blocked", parked: false });
  });
  it("blocked + diy builder → still improve (free-builder is a known target)", () => {
    const v = buildVerdict({ reachability: "blocked", status: "403 blocked", contentIssues: [], isDiyBuilder: true });
    expect(v).toEqual({ score: null, issues: ["diy_builder"], needs_improvement: true, reachability: "blocked", status: "403 blocked", parked: false });
  });
  it("unverified, not diy → unknown", () => {
    const v = buildVerdict({ reachability: "unverified", status: "timeout", contentIssues: [], isDiyBuilder: false });
    expect(v.needs_improvement).toBeNull();
  });
  it("dead + diy_builder → improve with diy_builder issue", () => {
    const v = buildVerdict({ reachability: "dead", status: "dns_error", contentIssues: [], isDiyBuilder: true });
    expect(v).toEqual({ score: 0, issues: ["diy_builder"], needs_improvement: true, reachability: "dead", status: "dns_error", parked: false });
  });
  it("parked → not improve, no score, status 'parked', parked flag set", () => {
    const v = buildVerdict({ reachability: "reachable", status: "200", contentIssues: ["no_https"], isDiyBuilder: false, parked: true });
    expect(v).toEqual({ score: null, issues: [], needs_improvement: false, reachability: "reachable", status: "parked", parked: true });
  });
});
