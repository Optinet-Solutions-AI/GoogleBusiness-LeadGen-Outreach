import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/services/openai-brain", () => ({
  brainJson: vi.fn(),
  BrainError: class BrainError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));

import { BrainError } from "@/lib/services/openai-brain";
import { draftMessage, draftPending, redraftLatest, RedraftTooSoonError, type DraftContext, type DraftDeps } from "./reply-ai-run";

const NOW = new Date("2026-12-01T10:00:00Z");
const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  messageId: "M1",
  leadId: "L1",
  reply: "Yes please, how much is it?\n\nOn Tue Grace wrote:\n> Hi Joe",
  attempts: 0,
  lead: { business_name: "Joe's Plumbing", category: "Plumber", city: "Austin", next_follow_up_at: null, segmentLead: { call_segment: "no_website" } },
  ourLast: { subject: "A website for Joe's", body: "We build modern websites." },
  sender: "Grace",
  offerKey: "website_build",
  ...over,
});

function deps(answer: unknown, over: Partial<DraftDeps> = {}) {
  const save = vi.fn(async () => {});
  const applyLead = vi.fn(async () => {});
  const ask = vi.fn(async () => ({ data: answer, usd: 0.008 }));
  const d: DraftDeps = { load: async () => ctx(), ask: ask as unknown as DraftDeps["ask"], save, applyLead, now: () => NOW, ...over };
  return { d, save, applyLead, ask };
}

describe("draftMessage", () => {
  it("drafts and saves an interested reply, and tells the lead its category", async () => {
    const { d, save, applyLead, ask } = deps({ category: "interested", summary: "Wants a price", body: "Hi Joe,\n\nThanks!\n\nBest regards,\nGrace", referral: null });
    const r = await draftMessage("M1", d);
    expect(r).toMatchObject({ ok: true, draft: { category: "interested", summary: "Wants a price" } });
    const input = (ask.mock.calls[0] as unknown[])[0] as { input: string; name: string };
    expect(input.name).toBe("reply_draft");
    expect(input.input).toContain("how much is it?");
    expect(input.input).not.toContain("> Hi Joe"); // their words only
    expect(save).toHaveBeenCalledWith("M1", expect.objectContaining({ ai_state: "done", ai_category: "interested", ai_draft_body: expect.stringContaining("Best regards"), ai_error: null }));
    expect(applyLead).toHaveBeenCalledWith("L1", expect.objectContaining({ leadPatch: { reply_category: "interested" }, unsubscribe: false, inboxStatus: "needs_reply" }), expect.anything());
  });

  it("a stop reply is unsubscribed with no draft body", async () => {
    const { d, save, applyLead } = deps({ category: "stop", summary: "Remove me", body: "ok", referral: null });
    await draftMessage("M1", d);
    expect(save).toHaveBeenCalledWith("M1", expect.objectContaining({ ai_category: "stop", ai_draft_body: "" }));
    expect(applyLead).toHaveBeenCalledWith("L1", expect.objectContaining({ unsubscribe: true, inboxStatus: "closed" }), expect.anything());
  });

  it("a failed try is counted; the third failure gives up", async () => {
    const bad = deps({ category: "nonsense", summary: "x", body: "y", referral: null });
    expect(await draftMessage("M1", bad.d)).toMatchObject({ ok: false });
    expect(bad.save).toHaveBeenCalledWith("M1", expect.objectContaining({ ai_attempts: 1, ai_state: "pending" }));
    expect(bad.applyLead).not.toHaveBeenCalled();
    const third = deps(null, { load: async () => ctx({ attempts: 2 }), ask: vi.fn(async () => { throw new Error("timeout"); }) as unknown as DraftDeps["ask"] });
    await draftMessage("M1", third.d);
    expect(third.save).toHaveBeenCalledWith("M1", expect.objectContaining({ ai_attempts: 3, ai_state: "failed", ai_error: expect.stringContaining("timeout") }));
  });
});

describe("draftPending", () => {
  it("drafts up to the cap", async () => {
    const draftOne = vi.fn(async () => ({ ok: true as const, draft: { usd: 0.01 } as never }));
    const r = await draftPending({ cap: 2 }, { listPending: async (cap) => ["a", "b", "c"].slice(0, cap), draftOne });
    expect(r).toEqual({ drafted: 2, failed: 0, usd: 0.02 });
  });

  it("stops at a dead key", async () => {
    const draftOne = vi.fn(async () => {
      throw new BrainError("no_credit", "x");
    });
    const r = await draftPending({ cap: 10 }, { listPending: async () => ["a", "b", "c"], draftOne });
    expect(draftOne).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ drafted: 0, failed: 1 });
  });

  it("without migration 078 it skips", async () => {
    const r = await draftPending({}, { listPending: async () => { throw new Error("column email_messages.ai_state does not exist"); }, draftOne: vi.fn() });
    expect(r).toEqual({ skipped: "Run database update 078 (AI reply handling)." });
  });
});

describe("redraftLatest", () => {
  it("refused within a minute of the last draft", async () => {
    await expect(
      redraftLatest("L1", NOW, { latest: async () => ({ id: "M1", ai_at: "2026-12-01T09:59:30Z" }), reset: vi.fn(), draftOne: vi.fn() }),
    ).rejects.toBeInstanceOf(RedraftTooSoonError);
  });

  it("redrafts the latest reply", async () => {
    const reset = vi.fn(async () => {});
    const draftOne = vi.fn(async () => ({ ok: true as const, draft: { category: "question" } as never }));
    const r = await redraftLatest("L1", NOW, { latest: async () => ({ id: "M1", ai_at: "2026-12-01T09:50:00Z" }), reset, draftOne });
    expect(reset).toHaveBeenCalledWith("M1");
    expect(r).toMatchObject({ category: "question" });
  });

  it("no reply yet", async () => {
    await expect(redraftLatest("L1", NOW, { latest: async () => null, reset: vi.fn(), draftOne: vi.fn() })).rejects.toThrow("No reply to draft yet.");
  });
});
