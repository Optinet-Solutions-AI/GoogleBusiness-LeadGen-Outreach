import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-guard", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { checkMailboxHealth, type HealthDeps } from "./mailbox-health-run";
import type { HealthEvent, HealthSend } from "./mailbox-health";

const NOW = Date.parse("2026-12-10T12:00:00Z");
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function deps(over: Partial<HealthDeps> = {}): HealthDeps & { pause: ReturnType<typeof vi.fn> } {
  const sends: HealthSend[] = [];
  const events: HealthEvent[] = [];
  // grace: 31 sends, 4 of those leads hard-bounced; ethan: 25 sends, no bounces.
  for (let i = 0; i < 31; i++) sends.push({ lead_id: `g${i}`, from: "grace@x.com", at: at(48) });
  for (let i = 0; i < 25; i++) sends.push({ lead_id: `e${i}`, from: "ethan@y.com", at: at(48) });
  for (let i = 0; i < 4; i++) events.push({ lead_id: `g${i}`, kind: "bounce", at: at(24) });
  const pause = vi.fn(async () => true);
  return {
    mailboxes: async () => [
      { id: "G1", email: "grace@x.com", resumed_at: null },
      { id: "E1", email: "ethan@y.com", resumed_at: null },
    ],
    sends: async () => sends,
    events: async () => events,
    pause,
    ...over,
  } as HealthDeps & { pause: ReturnType<typeof vi.fn> };
}

describe("checkMailboxHealth", () => {
  it("pauses a mailbox over the bounce limit, with the reason, and leaves a healthy one alone", async () => {
    const d = deps();
    const r = await checkMailboxHealth(NOW, d);
    expect(r).toEqual({ checked: 2, paused: [{ email: "grace@x.com", reason: "4 hard bounces out of 31 emails in the last 7 days (13%)" }] });
    expect(d.pause).toHaveBeenCalledTimes(1);
    expect(d.pause).toHaveBeenCalledWith("G1", "4 hard bounces out of 31 emails in the last 7 days (13%)", new Date(NOW).toISOString());
  });

  it("a pause another run already made isn't reported twice", async () => {
    const d = deps({ pause: vi.fn(async () => false) });
    expect(await checkMailboxHealth(NOW, d)).toEqual({ checked: 2, paused: [] });
  });

  it("a mailbox resumed after the bounces isn't paused again by them", async () => {
    const d = deps({ mailboxes: async () => [{ id: "G1", email: "grace@x.com", resumed_at: at(12) }] });
    expect(await checkMailboxHealth(NOW, d)).toEqual({ checked: 1, paused: [] });
  });

  it("without migration 077 it skips and pauses nothing", async () => {
    const d = deps({ mailboxes: async () => { throw new Error("column email_accounts.resumed_at does not exist"); } });
    expect(await checkMailboxHealth(NOW, d)).toEqual({ skipped: "Run database update 077 (mailbox auto-pause)." });
    expect(d.pause).not.toHaveBeenCalled();
  });

  it("no active mailbox: nothing to check", async () => {
    expect(await checkMailboxHealth(NOW, deps({ mailboxes: async () => [] }))).toEqual({ checked: 0, paused: [] });
  });
});
