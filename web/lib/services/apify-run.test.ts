/**
 * apify-run.test.ts — run one Apify robot: start with a spending cap, wait, abort on request, read its rows.
 *
 * Inputs:  a fake fetch that answers like the Apify API
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("../config", () => ({ env: { APIFY_TOKEN: "tok" } }));
vi.mock("../logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));
vi.mock("../retry", () => ({ retry: <T,>(fn: () => Promise<T>) => fn() }));

import { ApifyRunError, runActor } from "./apify-run";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake Apify: the run reports `statuses` in turn, then the dataset returns `items`. */
function fakeApify(opts: { statuses: string[]; items: unknown[]; startStatus?: number; startBody?: unknown; usage?: number; usages?: number[] }) {
  const calls: { url: string; method: string; body?: string }[] = [];
  let poll = 0;
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body as string | undefined });
    if (u.includes("/runs?")) {
      if (opts.startStatus && opts.startStatus >= 400) return json(opts.startBody ?? {}, opts.startStatus);
      return json({ data: { id: "run1", status: "RUNNING", defaultDatasetId: "ds1" } });
    }
    if (u.includes("/abort")) return json({ data: { id: "run1", status: "ABORTED" } });
    if (u.includes("/actor-runs/run1")) {
      const n = poll++;
      const status = opts.statuses[Math.min(n, opts.statuses.length - 1)];
      const usage = opts.usages ? opts.usages[Math.min(n, opts.usages.length - 1)] : (opts.usage ?? 0.012);
      return json({ data: { id: "run1", status, defaultDatasetId: "ds1", usageTotalUsd: usage } });
    }
    if (u.includes("/datasets/ds1/items")) return json(opts.items);
    return json({}, 404);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("runActor", () => {
  it("starts with the spending cap, waits for SUCCEEDED and returns the rows and the real cost", async () => {
    const { fetchImpl, calls } = fakeApify({ statuses: ["RUNNING", "SUCCEEDED"], items: [{ name: "A" }, { name: "B" }] });
    const r = await runActor<{ name: string }>({ actor: "me~robot", input: { q: 1 }, maxChargeUsd: 0.25, pollMs: 0, fetchImpl });
    expect(r).toEqual({ items: [{ name: "A" }, { name: "B" }], status: "SUCCEEDED", usageUsd: 0.012, cutShort: false });
    expect(calls[0].url).toContain("/acts/me~robot/runs?");
    expect(calls[0].url).toContain("maxTotalChargeUsd=0.25");
    expect(calls[0].body).toBe(JSON.stringify({ q: 1 }));
  });

  it("explains a refused start in Apify's own words", async () => {
    const { fetchImpl } = fakeApify({ statuses: [], items: [], startStatus: 400, startBody: { error: { type: "invalid-input", message: "Cannot parse input JSON body" } } });
    await expect(runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, fetchImpl })).rejects.toThrow(/Cannot parse input/);
    await expect(runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, fetchImpl })).rejects.toBeInstanceOf(ApifyRunError);
  });

  it("aborts when asked to stop and keeps what was found", async () => {
    const { fetchImpl, calls } = fakeApify({ statuses: ["RUNNING"], items: [{ name: "A" }] });
    const r = await runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, fetchImpl, shouldStop: () => true });
    expect(calls.some((c) => c.url.includes("/abort") && c.method === "POST")).toBe(true);
    expect(r.items).toHaveLength(1);
  });

  it("fails clearly when the run fails and found nothing", async () => {
    const { fetchImpl } = fakeApify({ statuses: ["FAILED"], items: [] });
    await expect(runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, fetchImpl })).rejects.toThrow(/FAILED/);
  });

  it("fails in words when the spending cap or Apify stopped the run before it found anything", async () => {
    const { fetchImpl } = fakeApify({ statuses: ["ABORTED"], items: [] });
    await expect(runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, fetchImpl })).rejects.toThrow(/stopped early/);
  });

  it("fails in words when our time limit cut the run before it found anything", async () => {
    const { fetchImpl } = fakeApify({ statuses: ["RUNNING", "RUNNING", "ABORTED"], items: [] });
    await expect(runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, deadlineMs: 0, fetchImpl })).rejects.toThrow(/time limit/);
  });

  it("marks a run cut short with rows, and re-reads the final cost after stopping it", async () => {
    const { fetchImpl, calls } = fakeApify({ statuses: ["ABORTED"], items: [{ name: "A" }], usage: 0.02 });
    const r = await runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, deadlineMs: 0, fetchImpl });
    expect(r).toMatchObject({ items: [{ name: "A" }], cutShort: true, status: "ABORTED", usageUsd: 0.02 });
    const abortAt = calls.findIndex((c) => c.url.includes("/abort"));
    expect(calls.slice(abortAt + 1).some((c) => c.url.includes("/actor-runs/run1?"))).toBe(true);
  });

  it("an operator cancel with nothing found is not an error", async () => {
    const { fetchImpl } = fakeApify({ statuses: ["RUNNING", "ABORTED"], items: [] });
    const r = await runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, fetchImpl, shouldStop: () => true });
    expect(r).toMatchObject({ items: [], cutShort: true });
  });

  it("a normal finished run is not cut short", async () => {
    const { fetchImpl } = fakeApify({ statuses: ["SUCCEEDED"], items: [{ name: "A" }] });
    expect((await runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, fetchImpl })).cutShort).toBe(false);
  });

  it("reports Apify's final charge, which is added a moment after the run finishes", async () => {
    // Live check 19 Nov 2026: TripAdvisor showed $0.005 at finish, $0.035 once Apify billed the places.
    const { fetchImpl } = fakeApify({ statuses: ["SUCCEEDED", "SUCCEEDED"], items: [{ name: "A" }], usages: [0.005, 0.035] });
    const r = await runActor({ actor: "me~robot", input: {}, maxChargeUsd: 0.1, pollMs: 0, settleMs: 0, fetchImpl });
    expect(r.usageUsd).toBe(0.035);
  });
});

