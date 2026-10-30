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
}));
vi.mock("./ongage", () => ({ sendEmailOngage: mocks.sendEmailOngage, isOngageConfigured: mocks.isOngageConfigured }));
vi.mock("../db", () => {
  // Chainable query stub: every builder call returns itself; maybeSingle yields the mailbox row.
  const q: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "not", "limit", "gte"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: mocks.row });
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

    expect(res).toEqual({ sent: true, noop: false, messageId: "<ongage@x>" });
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
