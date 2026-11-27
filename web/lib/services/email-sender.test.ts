/**
 * email-sender.test.ts — lock the send routing: every mailbox sends through Ongage. Ongage + DB are mocked.
 *
 * Inputs:  mocked ongage and db modules
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendEmailOngage: vi.fn(),
  isOngageConfigured: vi.fn(),
  row: null as Record<string, unknown> | null,
  /** When set, each maybeSingle() takes the next row from here (getSenderAccount, then mailboxStatus). */
  rows: null as (Record<string, unknown> | null)[] | null,
  // Test mode (075): switched off unless a test switches it on.
  testMode: { on: false, emails: [] as string[], phones: [] as string[], hosts: [] as string[] },
}));
vi.mock("@/lib/test-mode", async () => {
  const rules = await vi.importActual<typeof import("@/lib/test-mode-rules")>("@/lib/test-mode-rules");
  return { ...rules, getTestMode: async () => mocks.testMode };
});
vi.mock("./ongage", () => ({ sendEmailOngage: mocks.sendEmailOngage, isOngageConfigured: mocks.isOngageConfigured }));
vi.mock("../db", () => {
  // Chainable query stub: every builder call returns itself; maybeSingle yields the mailbox row.
  const q: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "not", "limit", "gte"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: mocks.rows ? (mocks.rows.shift() ?? null) : mocks.row });
  return { getDb: () => q };
});

import { sendFromAccount, sendOutreachEmail } from "./email-sender";

// A mailbox row with no SMTP login: sending needs only the address (Ongage sends it).
const mailbox = {
  email: "lucas@rateupdigital.com",
  from_name: "Lucas RateUp",
  status: "active",
  daily_cap: null,
  warmup_started_at: null,
  warmup_target_cap: null,
  warmup_ramp_days: null,
};

const account = {
  email: mailbox.email,
  fromName: mailbox.from_name,
  daily_cap: null,
  warmup_started_at: null,
  warmup_target_cap: null,
  warmup_ramp_days: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = null;
  mocks.sendEmailOngage.mockResolvedValue({ success: true, messageId: "<ongage@x>" });
  mocks.isOngageConfigured.mockReturnValue(true);
});

describe("sendFromAccount", () => {
  it("sends through Ongage under the mailbox's address, with the screenshot as a URL", async () => {
    const res = await sendFromAccount(account, "joe@example.com", "Hi", "<p>x</p>", {
      screenshotPath: "https://cdn.example.com/shot.png",
      inReplyTo: "<a@b>",
    });

    expect(res).toEqual({ success: true, messageId: "<ongage@x>" });
    expect(mocks.sendEmailOngage).toHaveBeenCalledWith(
      "joe@example.com",
      "Hi",
      "<p>x</p>",
      { screenshotUrl: "https://cdn.example.com/shot.png" },
      expect.objectContaining({ email: "lucas@rateupdigital.com", fromName: "Lucas RateUp" }),
    );
  });
});

describe("sendOutreachEmail", () => {
  it("sends a mailbox that has no SMTP login through Ongage", async () => {
    mocks.row = { ...mailbox };

    const res = await sendOutreachEmail({ to: "joe@example.com", subject: "Hi", html: "<p>x</p>" });

    expect(res).toEqual({ sent: true, noop: false, messageId: "<ongage@x>", from: "lucas@rateupdigital.com" });
    expect(mocks.sendEmailOngage).toHaveBeenCalledTimes(1);
  });

  it("holds (never fails) every send while Ongage isn't configured on this server", async () => {
    mocks.row = { ...mailbox };
    mocks.isOngageConfigured.mockReturnValue(false);

    const res = await sendOutreachEmail({ to: "joe@example.com", subject: "Hi", html: "<p>x</p>" });

    expect(res).toEqual({ sent: false, noop: false, messageId: null, reason: "paused" });
    expect(mocks.sendEmailOngage).not.toHaveBeenCalled();
  });
});

describe("Test mode (26 Nov 2026): nothing reaches a real business while QA tests", () => {
  beforeEach(() => {
    mocks.sendEmailOngage.mockReset();
    mocks.sendEmailOngage.mockResolvedValue({ success: true, messageId: "m1" });
    mocks.testMode = { on: true, emails: ["qa@test.example"], phones: [], hosts: [] };
  });

  it("refuses an address that isn't on the test list, without calling Ongage", async () => {
    const r = await sendFromAccount(account, "owner@realplumber.com", "Hi", "<p>x</p>", {});
    expect(r).toEqual({ success: false, error: expect.stringMatching(/^Test mode is on/) });
    expect(mocks.sendEmailOngage).not.toHaveBeenCalled();
  });

  it("sends to a test address", async () => {
    expect(await sendFromAccount(account, "QA@test.example", "Hi", "<p>x</p>", {})).toEqual({ success: true, messageId: "m1" });
  });

  it("a sequence email to a real business waits (held like the kill switch: the sequence is not stopped)", async () => {
    mocks.row = mailbox;
    mocks.isOngageConfigured.mockReturnValue(true);
    const r = await sendOutreachEmail({ to: "owner@realplumber.com", subject: "Hi", html: "<p>x</p>" });
    expect(r).toMatchObject({ sent: false, reason: "paused" });
    expect(mocks.sendEmailOngage).not.toHaveBeenCalled();
  });
});

describe("a paused mailbox (auto-pause, 27 Nov 2026)", () => {
  beforeEach(() => {
    mocks.testMode = { on: false, emails: [], phones: [], hosts: [] }; // an earlier block leaves Test mode on
  });

  it("a follow-up pinned to a paused mailbox waits (held), never counted as sent", async () => {
    mocks.rows = [null, { status: "paused" }]; // no ACTIVE row with that address; the mailbox exists, paused
    const res = await sendOutreachEmail({ to: "joe@example.com", subject: "s", html: "h", senderEmail: "grace@x.com" });
    expect(res).toEqual({ sent: false, noop: false, messageId: null, reason: "paused", mailboxPaused: true });
    expect(mocks.sendEmailOngage).not.toHaveBeenCalled();
  });

  it("with no mailbox at all it stays the old dev no-op", async () => {
    mocks.rows = [null, null];
    expect(await sendOutreachEmail({ to: "joe@example.com", subject: "s", html: "h", senderEmail: "gone@x.com" })).toMatchObject({ sent: true, noop: true });
  });
});
