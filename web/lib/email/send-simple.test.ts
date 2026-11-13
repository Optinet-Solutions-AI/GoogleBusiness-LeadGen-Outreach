/**
 * send-simple.test.ts — the lead page "Send email": one plain email, same safety rules as every other send.
 *
 * Inputs:  fake deps (no db, no network)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import { sendSimpleEmail, followUpPatch, type SimpleLead, type SimpleSendDeps } from "./send-simple";
import { textToHtml } from "./plain-text";

const LEAD: SimpleLead = {
  id: "L1",
  email: "owner@joes.com",
  stage: "scraped",
  inbox_status: "none",
  verification_status: "valid",
  phone: null,
  lifecycle_stage: null,
  address: null,
  country_code: "us",
};
const ACCOUNT = { email: "sam@rateup.com", fromName: "Sam", daily_cap: 50, warmup_started_at: null, warmup_target_cap: null, warmup_ramp_days: null };

function deps(over: Partial<SimpleSendDeps> = {}, lead: Partial<SimpleLead> = {}): SimpleSendDeps {
  return {
    paused: () => false,
    configured: () => true,
    load: async () => ({ ...LEAD, ...lead }),
    suppressed: async () => false,
    verificationOn: () => true,
    verify: vi.fn(async () => ({ status: "valid" })),
    account: async () => ACCOUNT,
    send: vi.fn(async () => ({ success: true as const, messageId: "m1" })),
    record: vi.fn(async () => {}),
    scheduleFollowUps: vi.fn(async () => ({ scheduled: true })),
    ...over,
  };
}
const MSG = { subject: "  Hello  ", body: "Hi Joe,\n\nQuick question.\nThanks" };

describe("sendSimpleEmail", () => {
  it("sends the text as written, from the chosen mailbox, and records it", async () => {
    const d = deps();
    const r = await sendSimpleEmail("L1", { ...MSG, senderEmail: "sam@rateup.com" }, d);
    expect(r).toEqual({ sent: true, via: "sam@rateup.com", checked: false, followUps: 0 });
    expect(d.send).toHaveBeenCalledWith(ACCOUNT, "owner@joes.com", "Hello", "<p>Hi Joe,</p>\n<p>Quick question.<br>Thanks</p>");
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ id: "L1" }), { via: "sam@rateup.com", messageId: "m1", subject: "Hello", body: MSG.body });
  });

  it("checks a never-checked address first and sends when it's good", async () => {
    const d = deps({}, { verification_status: null });
    const r = await sendSimpleEmail("L1", MSG, d);
    expect(d.verify).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ sent: true, checked: true });
  });

  it("refuses a bad or unconfirmed address and sends nothing", async () => {
    const bad = deps({ verify: vi.fn(async () => ({ status: "invalid" })) }, { verification_status: null });
    expect(await sendSimpleEmail("L1", MSG, bad)).toMatchObject({ sent: false, reason: "bad_address", checked: true });
    expect(bad.send).not.toHaveBeenCalled();
    const unsure = deps({ verify: vi.fn(async () => ({ status: "unknown" })) }, { verification_status: "unknown" });
    expect(await sendSimpleEmail("L1", MSG, unsure)).toMatchObject({ sent: false, reason: "unconfirmed" });
    expect(unsure.send).not.toHaveBeenCalled();
  });

  it("never emails an unsubscribed / do-not-contact lead", async () => {
    const d = deps({ suppressed: async () => true });
    expect(await sendSimpleEmail("L1", MSG, d)).toMatchObject({ sent: false, reason: "suppressed" });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("honours the kill switch and a server without Ongage", async () => {
    expect(await sendSimpleEmail("L1", MSG, deps({ paused: () => true }))).toMatchObject({ sent: false, reason: "paused" });
    expect(await sendSimpleEmail("L1", MSG, deps({ configured: () => false }))).toMatchObject({ sent: false, reason: "not_configured" });
  });

  it("needs an email and a mailbox", async () => {
    expect(await sendSimpleEmail("L1", MSG, deps({}, { email: null }))).toMatchObject({ sent: false, reason: "no_email" });
    expect(await sendSimpleEmail("L1", MSG, deps({ account: async () => null }))).toMatchObject({ sent: false, reason: "no_mailbox" });
  });

  it("reports a failed send with the provider's reason and records nothing", async () => {
    const d = deps({ send: vi.fn(async () => ({ success: false as const, error: "Ongage said no" })) });
    const r = await sendSimpleEmail("L1", MSG, d);
    expect(r).toMatchObject({ sent: false, reason: "send_failed" });
    expect(r.sent === false && r.message).toContain("Ongage said no");
    expect(d.record).not.toHaveBeenCalled();
  });

  it("works for any lead type: no website or demo needed", async () => {
    const r = await sendSimpleEmail("L1", MSG, deps({}, { stage: "scraped" }));
    expect(r.sent).toBe(true);
  });

  it("says the checker is out of credits instead of blaming the address", async () => {
    const d = deps({ verify: vi.fn(async () => ({ status: "unknown", audit: { zerobounce_result: "no_credits" } })) }, { verification_status: null });
    const r = await sendSimpleEmail("L1", MSG, d);
    expect(r).toMatchObject({ sent: false, reason: "checker_down" });
    expect(r.sent === false && r.message).toContain("out of credits");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("schedules the follow-ups after the first email goes out (blank ones dropped, max 2)", async () => {
    const d = deps();
    const r = await sendSimpleEmail("L1", { ...MSG, followUps: ["First nudge", "  ", "Last note", "extra"] }, d);
    expect(r).toMatchObject({ sent: true, followUps: 2 });
    expect(d.scheduleFollowUps).toHaveBeenCalledWith(expect.objectContaining({ id: "L1" }), {
      via: "sam@rateup.com",
      subject: "Hello",
      followUps: ["First nudge", "Last note"],
    });
  });

  it("never schedules follow-ups when the first email didn't go out", async () => {
    const d = deps({ send: vi.fn(async () => ({ success: false as const, error: "nope" })) });
    await sendSimpleEmail("L1", { ...MSG, followUps: ["First nudge"] }, d);
    expect(d.scheduleFollowUps).not.toHaveBeenCalled();
  });

  it("still reports the email as sent when the follow-ups couldn't be saved", async () => {
    const d = deps({ scheduleFollowUps: vi.fn(async () => ({ scheduled: false, note: "update 060 missing" })) });
    const r = await sendSimpleEmail("L1", { ...MSG, followUps: ["First nudge"] }, d);
    expect(r).toEqual({ sent: true, via: "sam@rateup.com", checked: false, followUps: 0, note: "update 060 missing" });
  });
});

describe("followUpPatch", () => {
  it("hands the follow-ups to the sequence tick as replies, starting after the first email", () => {
    const now = Date.parse("2026-11-13T10:00:00Z");
    const p = followUpPatch({ via: "sam@rateup.com", subject: "A website for Joe's", followUps: ["Nudge", "Last"] }, now);
    expect(p).toEqual({
      seq_status: "active",
      seq_step: 1,
      seq_next_step_at: "2026-11-17T10:00:00.000Z",
      seq_sender_email: "sam@rateup.com",
      seq_copy_overrides: {
        "2": { subject: "Re: A website for Joe's", body: "Nudge" },
        "3": { subject: "Re: A website for Joe's", body: "Last" },
      },
      seq_max_step: 3,
    });
  });
});

describe("textToHtml", () => {
  it("escapes what the operator typed", () => {
    expect(textToHtml("<b>5 > 3</b> & more")).toBe("<p>&lt;b&gt;5 &gt; 3&lt;/b&gt; &amp; more</p>");
  });
});
