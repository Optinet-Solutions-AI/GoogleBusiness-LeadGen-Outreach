/**
 * voizo-train.test.ts — the Voizo "train a script" calls: where they go, what they send, how answers are read.
 *
 * Inputs:  a fake fetch (no network)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("../config", () => ({ env: { VOIZO_API_KEY: "k".repeat(20), VOIZO_API_BASE: "https://voizo.test" } }));
vi.mock("../logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { applyTraining, listScripts, listTrainingChanges, trainScript, undoTraining } from "./voizo";

function fakeFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe("trainScript", () => {
  it("posts the instruction to the campaign's train endpoint and reads the proposal", async () => {
    const f = fakeFetch(200, {
      reply: "I'll drop the price from the opener.",
      proposal: { id: "p1", expiresAt: "2026-11-23T12:00:00Z", edits: [{ label: "Opener", before: "Hi, it's $99.", after: "Hi." }] },
    });
    const r = await trainScript("camp 1", { instruction: "Don't mention price", history: [{ role: "user", text: "hi" }] });
    expect(r).toEqual({
      ok: true,
      data: { reply: "I'll drop the price from the opener.", proposal: { id: "p1", expiresAt: "2026-11-23T12:00:00Z", edits: [{ label: "Opener", before: "Hi, it's $99.", after: "Hi." }] } },
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://voizo.test/api/v1/scripts/camp%201/train");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ instruction: "Don't mention price", history: [{ role: "user", text: "hi" }] });
  });
  it("reads a reply with no proposal (the agent asked a question back)", async () => {
    fakeFetch(200, { reply: "Which opener do you mean?", proposal: null });
    const r = await trainScript("c1", { instruction: "shorter" });
    expect(r.ok && r.data.proposal).toBeNull();
  });
  it("is not retried and reports 404 as http_404 (training not shipped in Voizo yet)", async () => {
    const f = fakeFetch(404, {});
    const r = await trainScript("c1", { instruction: "x" });
    expect(r).toMatchObject({ ok: false, code: "http_404" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("accepts statements as a list", async () => {
    fakeFetch(200, { reply: "ok", proposal: { id: "p2", edits: [{ label: "Pitch", before: ["a", "b"], after: ["a"] }] } });
    const r = await trainScript("c1", { instruction: "x" });
    expect(r.ok && r.data.proposal?.edits[0].after).toEqual(["a"]);
  });
});

describe("listScripts", () => {
  it("reads which scripts can be trained", async () => {
    fakeFetch(200, { scripts: [{ campaignId: "c1", offerKey: "seo", trainable: true }, { campaignId: "c2", offerKey: "x", trainable: false }] });
    const r = await listScripts();
    expect(r.ok && r.data.scripts.map((s) => s.trainable)).toEqual([true, false]);
  });
});

describe("applyTraining / undoTraining / listTrainingChanges", () => {
  it("applies a proposal by id only", async () => {
    const f = fakeFetch(200, { changeId: "ch1", appliedAt: "2026-11-23T12:00:00Z", edits: 2 });
    const r = await applyTraining("c1", "p 1");
    expect(r).toMatchObject({ ok: true, data: { changeId: "ch1" } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://voizo.test/api/v1/scripts/c1/train/p%201/apply");
    expect(init.body).toBeUndefined();
  });
  it("passes Voizo's stale_proposal code through", async () => {
    fakeFetch(409, { error: "The script changed.", code: "stale_proposal" });
    expect(await applyTraining("c1", "p1")).toMatchObject({ ok: false, status: 409, code: "stale_proposal" });
  });
  it("passes Voizo's plain conflict detail through", async () => {
    fakeFetch(409, { error: "x", code: "undo_conflict", conflict_detail: "The opening line was changed again." });
    expect(await undoTraining("c1", "ch1")).toMatchObject({ ok: false, code: "undo_conflict", detail: "The opening line was changed again." });
  });
  it("passes the daily limit through when a campaign is out of training requests", async () => {
    fakeFetch(429, { error: "x", code: "rate_limited", usedToday: 40, cap: 40 });
    expect(await trainScript("c1", { instruction: "x" })).toMatchObject({ ok: false, status: 429, code: "rate_limited", cap: 40 });
  });
  it("reports a failed live update as provision_failed", async () => {
    fakeFetch(503, { error: "Vapi refused the new wording.", code: "provision_failed" });
    expect(await applyTraining("c1", "p1")).toMatchObject({ ok: false, status: 503, code: "provision_failed" });
  });
  it("undoes a change", async () => {
    const f = fakeFetch(200, { undone: true });
    expect(await undoTraining("c1", "ch1")).toEqual({ ok: true, data: { undone: true } });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://voizo.test/api/v1/scripts/c1/changes/ch1/undo");
  });
  it("lists recent changes", async () => {
    const f = fakeFetch(200, { changes: [{ id: "ch1", instruction: "no price", summary: "Opener shortened", appliedAt: "2026-11-23T12:00:00Z", undoneAt: null, edits: [] }] });
    const r = await listTrainingChanges("c1");
    expect(r.ok && r.data.changes[0].id).toBe("ch1");
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://voizo.test/api/v1/scripts/c1/changes?limit=20");
  });
});
