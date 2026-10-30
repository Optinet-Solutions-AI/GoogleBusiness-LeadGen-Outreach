/**
 * email-sender.test.ts — lock the per-mailbox send routing (own SMTP vs Ongage). Providers + DB are mocked.
 *
 * Inputs:  mocked smtp-sender, ongage and db modules
 * Outputs: vitest assertions
 * Used by: vitest (npm test)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendEmailSmtp: vi.fn(),
  sendEmailOngage: vi.fn(),
  isOngageConfigured: vi.fn(),
  row: null as Record<string, unknown> | null,
}));
vi.mock("./smtp-sender", () => ({ sendEmailSmtp: mocks.sendEmailSmtp }));
vi.mock("./ongage", () => ({ sendEmailOngage: mocks.sendEmailOngage, isOngageConfigured: mocks.isOngageConfigured }));
vi.mock("../db", () => {
  // Chainable query stub: every builder call returns itself; maybeSingle yields the mailbox row.
  const q: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "not", "limit", "gte"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: mocks.row });
  return { getDb: () => q };
});

import { sendFromAccount, sendOutreachEmail } from "./email-sender";

const mailbox = {
  email: "lucas@rateupdigital.com",
  from_name: "Lucas RateUp",
  smtp_host: "smtp.titan.email",
  smtp_port: 465,
  smtp_user: "lucas@rateupdigital.com",
  smtp_password: "pw",
  imap_host: null,
  imap_port: null,
  imap_user: null,
  imap_pass: null,
  status: "active",
  daily_cap: null,
  warmup_started_at: null,
  warmup_target_cap: null,
  warmup_ramp_days: null,
};

function account(email_provider: string | null) {
  return {
    email: mailbox.email,
    fromName: mailbox.from_name,
    auth_type: "smtp" as const,
    smtp_host: mailbox.smtp_host,
    smtp_port: mailbox.smtp_port,
    smtp_user: mailbox.smtp_user,
    smtp_password: mailbox.smtp_password,
    email_provider,
    daily_cap: null,
    warmup_started_at: null,
    warmup_target_cap: null,
    warmup_ramp_days: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendEmailSmtp.mockResolvedValue({ success: true, messageId: "<smtp@x>" });
  mocks.sendEmailOngage.mockResolvedValue({ success: true, messageId: "<ongage@x>" });
  mocks.isOngageConfigured.mockReturnValue(true);
});

describe("sendFromAccount", () => {
  it("sends an Ongage mailbox through Ongage, with the screenshot as a URL", async () => {
    const res = await sendFromAccount(account("ongage"), "joe@example.com", "Hi", "<p>x</p>", {
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
    expect(mocks.sendEmailSmtp).not.toHaveBeenCalled();
  });

  it("keeps every other mailbox on its own SMTP", async () => {
    for (const provider of ["smtp", null]) {
      await sendFromAccount(account(provider), "joe@example.com", "Hi", "<p>x</p>", { inReplyTo: "<a@b>" });
    }
    expect(mocks.sendEmailSmtp).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmailSmtp).toHaveBeenCalledWith(
      "joe@example.com",
      "Hi",
      "<p>x</p>",
      { inReplyTo: "<a@b>" },
      expect.objectContaining({ email: "lucas@rateupdigital.com" }),
    );
    expect(mocks.sendEmailOngage).not.toHaveBeenCalled();
  });
});

describe("sendOutreachEmail", () => {
  it("holds (never fails) an Ongage mailbox while Ongage isn't configured on this server", async () => {
    mocks.row = { ...mailbox, email_provider: "ongage" };
    mocks.isOngageConfigured.mockReturnValue(false);

    const res = await sendOutreachEmail({ to: "joe@example.com", subject: "Hi", html: "<p>x</p>" });

    expect(res).toEqual({ sent: false, noop: false, messageId: null, reason: "paused" });
    expect(mocks.sendEmailOngage).not.toHaveBeenCalled();
    expect(mocks.sendEmailSmtp).not.toHaveBeenCalled();
  });
});
