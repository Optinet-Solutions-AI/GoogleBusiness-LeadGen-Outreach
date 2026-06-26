import { describe, it, expect } from "vitest";
import { resolveSendSlot, type ResolveSendDeps } from "./sequence-scheduler";

// Build a deps object with sensible defaults; override per test. No sends in
// history and a 0ms gap by default, so the per-mailbox gap never interferes
// unless a test opts into it.
function deps(over: Partial<ResolveSendDeps> = {}): ResolveSendDeps {
  return {
    loadCampaign: async () => null,
    remainingFor: async () => 5,
    allMailboxes: async () => ["a@x.com", "b@x.com"],
    lastSentFor: async () => null,
    recentSends: new Map(),
    gapMs: () => 0,
    ...over,
  };
}

describe("resolveSendSlot", () => {
  const baseLead = { id: "lead1", seq_sender_email: null, country_code: "us" } as any;

  it("pins a pool mailbox with capacity on first send", async () => {
    const out = await resolveSendSlot(
      baseLead,
      deps({
        loadCampaign: async () => ({
          sender_emails: ["a@x.com", "b@x.com"], sender_email: null,
          call_days: [1, 2, 3, 4, 5], call_start_hour: 9, call_end_hour: 17,
          country_code: "us", copy_overrides: null, copy_style: "friendly",
        }),
        remainingFor: async (email: string) => (email === "a@x.com" ? 0 : 5),
      }),
    );
    // a@ is capped, so it must pick b@.
    expect(out).toEqual(expect.objectContaining({ senderEmail: "b@x.com" }));
  });

  it("reuses the already-pinned sender (follow-up)", async () => {
    const out = await resolveSendSlot(
      { ...baseLead, seq_sender_email: "pinned@x.com" },
      deps({ allMailboxes: async () => ["other@x.com"] }),
    );
    expect(out).toEqual(expect.objectContaining({ senderEmail: "pinned@x.com" }));
  });

  it("defers (long) when no mailbox has capacity", async () => {
    const out = await resolveSendSlot(
      baseLead,
      deps({ remainingFor: async () => 0, allMailboxes: async () => ["a@x.com"] }),
    );
    expect(out).toEqual({ defer: true, retryMinutes: expect.any(Number) });
    // cap defer is a long wait (hours), not a few minutes
    expect((out as { retryMinutes: number }).retryMinutes).toBeGreaterThan(60);
  });

  it("defers (short) when mailboxes have capacity but sent within the gap", async () => {
    const out = await resolveSendSlot(
      baseLead,
      deps({
        allMailboxes: async () => ["a@x.com", "b@x.com"],
        lastSentFor: async () => Date.now() - 10_000, // 10s ago
        gapMs: () => 5 * 60_000, // 5-min gap → both resting
      }),
    );
    expect("defer" in out).toBe(true);
    expect((out as { retryMinutes: number }).retryMinutes).toBeLessThanOrEqual(20);
  });

  it("skips a mailbox that sent within the gap and picks the rested one", async () => {
    const out = await resolveSendSlot(
      baseLead,
      deps({
        allMailboxes: async () => ["a@x.com", "b@x.com"],
        // a@ sent 10s ago (resting), b@ never → b@ must be chosen.
        lastSentFor: async (email: string) => (email === "a@x.com" ? Date.now() - 10_000 : null),
        gapMs: () => 5 * 60_000,
      }),
    );
    expect(out).toEqual(expect.objectContaining({ senderEmail: "b@x.com" }));
  });

  it("defers a pinned sender that sent within the gap (anti back-to-back)", async () => {
    const out = await resolveSendSlot(
      { ...baseLead, seq_sender_email: "pinned@x.com" },
      deps({
        lastSentFor: async () => Date.now() - 30_000, // 30s ago
        gapMs: () => 5 * 60_000,
      }),
    );
    expect("defer" in out).toBe(true);
  });

  it("honors an in-run send via recentSends", async () => {
    const recent = new Map<string, number>([["a@x.com", Date.now()]]);
    const out = await resolveSendSlot(
      baseLead,
      deps({
        allMailboxes: async () => ["a@x.com", "b@x.com"],
        lastSentFor: async () => null, // nothing persisted yet
        recentSends: recent,
        gapMs: () => 5 * 60_000,
      }),
    );
    // a@ just sent THIS run → must pick b@.
    expect(out).toEqual(expect.objectContaining({ senderEmail: "b@x.com" }));
  });
});
