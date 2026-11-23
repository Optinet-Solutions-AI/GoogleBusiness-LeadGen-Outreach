/**
 * train-agent.test.ts — "Train a voice agent" server side: what goes to Voizo and how refusals come back.
 *
 * Inputs:  fake Voizo calls (no network)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/services/voizo", () => ({
  isVoizoConfigured: () => true,
  listScripts: vi.fn(),
  trainScript: vi.fn(),
  applyTraining: vi.fn(),
  undoTraining: vi.fn(),
  listTrainingChanges: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { askTrainer, listTrainable, recentChanges, saveTraining, undoChange, type TrainDeps } from "./train-agent";

function deps(over: Partial<TrainDeps> = {}): TrainDeps {
  return {
    configured: () => true,
    scripts: vi.fn(async () => ({ ok: true as const, data: { scripts: [] } })),
    train: vi.fn(async () => ({ ok: true as const, data: { reply: "ok", proposal: null } })),
    apply: vi.fn(async () => ({ ok: true as const, data: { changeId: "ch1" } })),
    undo: vi.fn(async () => ({ ok: true as const, data: { undone: true } })),
    changes: vi.fn(async () => ({ ok: true as const, data: { changes: [] } })),
    ...over,
  };
}

describe("listTrainable", () => {
  it("lists the offers' scripts with our offer labels, skipping unnamed ones", async () => {
    const d = deps({
      scripts: vi.fn(async () => ({
        ok: true as const,
        data: {
          scripts: [
            { campaignId: "c-seo", offerKey: "seo", name: "Lead Gen API — seo" },
            { campaignId: "c-x", offerKey: null, name: "Scratch" },
            { campaignId: "c-new", offerKey: "brand_new_offer", name: "Lead Gen API — brand_new_offer" },
          ],
        },
      })),
    });
    const r = await listTrainable(d);
    expect(r.configured).toBe(true);
    expect(r.agents).toEqual([
      { campaignId: "c-seo", offerKey: "seo", label: "SEO (show up higher on Google)" },
      { campaignId: "c-new", offerKey: "brand_new_offer", label: "Lead Gen API — brand_new_offer" },
    ]);
  });
  it("says not configured without calling Voizo", async () => {
    const d = deps({ configured: () => false });
    expect(await listTrainable(d)).toEqual({ configured: false, agents: [], note: expect.stringMatching(/isn't switched on/) });
    expect(d.scripts).not.toHaveBeenCalled();
  });
});

describe("askTrainer", () => {
  it("sends the instruction with the last 10 turns only", async () => {
    const d = deps();
    const history = Array.from({ length: 12 }, (_, i) => ({ role: "user" as const, text: `t${i}` }));
    await askTrainer("c1", "  Don't mention price  ", history, d);
    expect(d.train).toHaveBeenCalledWith("c1", { instruction: "Don't mention price", history: history.slice(-10), actor: "lead-gen operator" });
  });
  it("turns Voizo's 404 into 'not switched on yet' with a 503", async () => {
    const d = deps({ train: vi.fn(async () => ({ ok: false as const, status: 404, code: "http_404", error: "Not Found" })) });
    expect(await askTrainer("c1", "x", [], d)).toEqual({
      ok: false,
      status: 503,
      message: "Training isn't switched on in Voizo yet. The Voizo team needs to turn it on first.",
    });
  });
  it("returns the reply and proposal", async () => {
    const proposal = { id: "p1", edits: [{ label: "Opener", before: "a", after: "b" }] };
    const d = deps({ train: vi.fn(async () => ({ ok: true as const, data: { reply: "Changed.", proposal } })) });
    expect(await askTrainer("c1", "x", [], d)).toEqual({ ok: true, data: { reply: "Changed.", proposal } });
  });
});

describe("saveTraining / undoChange / recentChanges", () => {
  it("a stale suggestion is a 409 with a plain sentence", async () => {
    const d = deps({ apply: vi.fn(async () => ({ ok: false as const, status: 409, code: "stale_proposal", error: "x" })) });
    expect(await saveTraining("c1", "p1", d)).toMatchObject({ ok: false, status: 409, message: expect.stringMatching(/changed since this suggestion/) });
  });
  it("undo passes the ids through", async () => {
    const d = deps();
    expect(await undoChange("c1", "ch1", d)).toEqual({ ok: true, data: { undone: true } });
    expect(d.undo).toHaveBeenCalledWith("c1", "ch1");
  });
  it("history that can't be read is an empty list, not an error (the window still works)", async () => {
    const d = deps({ changes: vi.fn(async () => ({ ok: false as const, status: 404, code: "http_404", error: "x" })) });
    expect(await recentChanges("c1", d)).toEqual({ ok: true, data: { changes: [] } });
  });
});
