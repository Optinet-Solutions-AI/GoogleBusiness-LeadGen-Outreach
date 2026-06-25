import { describe, it, expect } from "vitest";
import { resolveSendSlot } from "./sequence-scheduler";

describe("resolveSendSlot", () => {
  const baseLead = { id: "lead1", seq_sender_email: null, country_code: "us" } as any;

  it("pins a pool mailbox with capacity on first send", async () => {
    const out = await resolveSendSlot(baseLead, {
      loadCampaign: async () => ({ sender_emails: ["a@x.com", "b@x.com"], sender_email: null, call_days: [1,2,3,4,5], call_start_hour: 9, call_end_hour: 17, country_code: "us" }),
      remainingFor: async (email: string) => (email === "a@x.com" ? 0 : 5),
      allMailboxes: async () => ["a@x.com", "b@x.com"],
    });
    // a@ is capped, so it must pick b@.
    expect(out).toEqual(expect.objectContaining({ senderEmail: "b@x.com" }));
  });

  it("reuses the already-pinned sender (follow-up)", async () => {
    const out = await resolveSendSlot({ ...baseLead, seq_sender_email: "pinned@x.com" }, {
      loadCampaign: async () => null,
      remainingFor: async () => 5,
      allMailboxes: async () => ["other@x.com"],
    });
    expect(out).toEqual(expect.objectContaining({ senderEmail: "pinned@x.com" }));
  });

  it("defers when no mailbox has capacity", async () => {
    const out = await resolveSendSlot(baseLead, {
      loadCampaign: async () => null,
      remainingFor: async () => 0,
      allMailboxes: async () => ["a@x.com"],
    });
    expect(out).toEqual({ defer: true });
  });
});
