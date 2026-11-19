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
function fakeApify(opts: { statuses: string[]; items: unknown[]; startStatus?: number; startBody?: unknown; usage?: number }) {
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
      const status = opts.statuses[Math.min(poll++, opts.statuses.length - 1)];
      return json({ data: { id: "run1", status, defaultDatasetId: "ds1", usageTotalUsd: opts.usage ?? 0.012 } });
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
    expect(r).toEqual({ items: [{ name: "A" }, { name: "B" }], status: "SUCCEEDED", usageUsd: 0.012 });
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
});
