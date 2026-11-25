/**
 * runs.test.ts — "Contact form" attempts: the gates before a look / send, one submit only, and what gets recorded.
 *
 * Inputs:  fake deps (no db, no browser, no OpenAI)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import { markSentByHand, markStartFailed, runLookThenSendStep, runSendStep, startLook, startLookThenSend, startSend, type FormLead, type RunsDeps } from "./runs";
import type { FormRun, RunStatus } from "./rules";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const LEAD: FormLead = {
  id: "L1", business_name: "Joe's Plumbing", website_url: "https://joes.com", contact_page_url: null, stage: "scraped",
  inbox_status: "none", lifecycle_stage: null, phone: null, address: null, country_code: "us",
};
function run(status: RunStatus, minsAgo = 1, over: Partial<FormRun> = {}): FormRun {
  const t = new Date(NOW - minsAgo * 60_000).toISOString();
  return {
    id: "R1", lead_id: "L1", status, contact_url: "https://joes.com/contact", form_shot_url: null, filled_shot_url: null,
    result_shot_url: null, sender_email: "grace@rp.rateupdigital.com", sender_name: "Grace", subject: "Hi", message: "Hello",
    offer_key: "seo", fields: null, reason: null, usd: null, created_at: t, updated_at: t, sent_at: null, ...over,
  };
}

function deps(over: Partial<RunsDeps> = {}, lead: Partial<FormLead> = {}): RunsDeps {
  return {
    now: () => NOW,
    paused: () => false,
    loadLead: async () => ({ ...LEAD, ...lead }),
    suppressed: async () => false,
    account: async () => ({ email: "grace@rp.rateupdigital.com", fromName: null }),
    latest: async () => run("ready"),
    claimWorker: vi.fn(async () => true),
    releaseSend: vi.fn(async () => {}),
    getRun: async () => run("sending"),
    insertRun: vi.fn(async (row) => ({ ...run("looking"), ...row })),
    updateRun: vi.fn(async () => {}),
    claimSend: vi.fn(async (_id, _lead, patch) => ({ ...run("sending"), ...patch })),
    look: vi.fn(),
    send: vi.fn(),
    upload: vi.fn(async (path: string) => `https://cdn/${path}`),
    insertEvent: vi.fn(async () => {}),
    updateLead: vi.fn(async () => {}),
    model: () => "gpt-6.1-sol",
    prices: () => ({ inPerMTok: 3, outPerMTok: 12 }),
    ...over,
  };
}
const SEND = { runId: "R1", subject: "Hi", message: "Hello there", offerKey: "seo" };

describe("startLook", () => {
  it("reuses a ready look from the last 24 h unless forced", async () => {
    const d = deps({ latest: async () => run("ready", 60) });
    const r = await startLook("L1", {}, d);
    expect(r).toMatchObject({ ok: true, reused: true });
    expect(d.insertRun).not.toHaveBeenCalled();
    const forced = await startLook("L1", { force: true }, d);
    expect(forced).toMatchObject({ ok: true, reused: false });
    expect(d.insertRun).toHaveBeenCalledOnce();
  });
  it("refuses a look while another run is active", async () => {
    const r = await startLook("L1", {}, deps({ latest: async () => run("sending", 2) }));
    expect(r).toMatchObject({ ok: false, reason: "busy" });
  });
  it("refuses a lead with no website or contact page", async () => {
    const r = await startLook("L1", {}, deps({}, { website_url: null, contact_page_url: null }));
    expect(r).toMatchObject({ ok: false, reason: "no_website" });
  });
  it("answers no_table when migration 065 is missing", async () => {
    const r = await startLook("L1", {}, deps({ latest: async () => "no_table" }));
    expect(r).toMatchObject({ ok: false, reason: "no_table" });
  });
});

describe("startSend", () => {
  it("refuses a second Send while the first is sending (one submit only)", async () => {
    const d = deps({ claimSend: vi.fn(async () => null) });
    const r = await startSend("L1", SEND, d);
    expect(r).toMatchObject({ ok: false, reason: "not_ready" });
  });
  it("refuses Send when the kill switch is on, without touching the run", async () => {
    const d = deps({ paused: () => true });
    expect(await startSend("L1", SEND, d)).toMatchObject({ ok: false, reason: "paused" });
    expect(d.claimSend).not.toHaveBeenCalled();
  });
  it("refuses Send when the lead unsubscribed after the look", async () => {
    const d = deps({ suppressed: async () => true });
    expect(await startSend("L1", SEND, d)).toMatchObject({ ok: false, reason: "suppressed" });
    expect(d.claimSend).not.toHaveBeenCalled();
  });
  it("refuses an empty message", async () => {
    expect(await startSend("L1", { ...SEND, message: "   " }, deps())).toMatchObject({ ok: false, reason: "empty" });
  });
  it("claims the run with the mailbox's name and address", async () => {
    const d = deps();
    const r = await startSend("L1", SEND, d);
    expect(r.ok).toBe(true);
    expect(d.claimSend).toHaveBeenCalledWith(
      "R1",
      "L1",
      expect.objectContaining({ status: "sending", sender_email: "grace@rp.rateupdigital.com", sender_name: "Grace", message: "Hello there" }),
    );
  });
});

describe("runSendStep", () => {
  const sent = {
    outcome: "sent" as const, reason: null, fields: [{ name: "Email", value: "grace@rp.rateupdigital.com" }],
    filledShot: Buffer.from("a"), resultShot: Buffer.from("b"), usage: { input_tokens: 100_000, output_tokens: 10_000 },
  };
  it("records contact_form_sent and moves scraped → outreached", async () => {
    const d = deps({ send: vi.fn(async () => sent) });
    await runSendStep("R1", d);
    expect(d.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ lead_id: "L1", kind: "contact_form_sent" }));
    expect(d.updateLead).toHaveBeenCalledWith("L1", expect.objectContaining({ stage: "outreached", inbox_status: "open" }));
    expect(d.updateRun).toHaveBeenLastCalledWith("R1", expect.objectContaining({ status: "sent", usd: 0.42 }));
  });
  it("keeps stage replied when a form is sent to a replied lead", async () => {
    const d = deps({ send: vi.fn(async () => sent) }, { stage: "replied", inbox_status: "needs_reply" });
    await runSendStep("R1", d);
    const patches = (d.updateLead as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(patches.every((p) => !("stage" in p) && !("inbox_status" in p))).toBe(true);
  });
  it("saves unknown, not failed, when the send step throws after starting", async () => {
    const d = deps({ send: vi.fn(async () => { throw new Error("boom"); }) });
    await runSendStep("R1", d);
    expect(d.updateRun).toHaveBeenLastCalledWith("R1", expect.objectContaining({ status: "unknown" }));
    expect(d.insertEvent).not.toHaveBeenCalled();
  });
  it("records contact_form_blocked (not sent) for a CAPTCHA", async () => {
    const d = deps({ send: vi.fn(async () => ({ ...sent, outcome: "blocked" as const, reason: "captcha", resultShot: null })) });
    await runSendStep("R1", d);
    expect(d.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "contact_form_blocked", meta: expect.objectContaining({ sent: false }) }),
    );
    expect(d.updateLead).not.toHaveBeenCalled();
  });
  it("does nothing for a run that isn't sending", async () => {
    const d = deps({ getRun: async () => run("sent"), send: vi.fn() });
    await runSendStep("R1", d);
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe("markStartFailed (the worker didn't start)", () => {
  it("puts a send back to ready: nothing was sent, so it can be retried", async () => {
    const d = deps();
    await markStartFailed("R1", "send", d);
    expect(d.releaseSend).toHaveBeenCalledWith("R1", expect.any(String));
  });
  it("marks a look failed", async () => {
    const d = deps();
    await markStartFailed("R1", "look", d);
    expect(d.updateRun).toHaveBeenCalledWith("R1", expect.objectContaining({ status: "failed" }));
  });
});

describe("review fixes: one send per lead, one worker per run, no late clicks", () => {
  it("refuses Send on a run that isn't the lead's latest (another tab looked again)", async () => {
    const d = deps({ latest: async () => run("ready", 1, { id: "R2" }) });
    expect(await startSend("L1", SEND, d)).toMatchObject({ ok: false, reason: "not_ready" });
    expect(d.claimSend).not.toHaveBeenCalled();
  });
  it("a second worker for the same run does nothing", async () => {
    const d = deps({ claimWorker: vi.fn(async () => false), send: vi.fn() });
    await runSendStep("R1", d);
    expect(d.send).not.toHaveBeenCalled();
  });
  it("a worker that starts 8+ minutes after Send gives up without sending", async () => {
    const d = deps({ getRun: async () => run("sending", 9), send: vi.fn() });
    await runSendStep("R1", d);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.updateRun).toHaveBeenLastCalledWith("R1", expect.objectContaining({ status: "failed" }));
  });
  it("hands the browser a deadline 8 minutes after Send was pressed", async () => {
    const send = vi.fn(async () => ({ outcome: "sent" as const, reason: null, fields: [], filledShot: null, resultShot: null, usage: { input_tokens: 0, output_tokens: 0 } }));
    await runSendStep("R1", deps({ send }));
    const claimedAt = NOW - 60_000;
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ deadline: claimedAt + 8 * 60_000 }));
  });
});

describe("markSentByHand (CAPTCHA hand-off, 24 Nov 2026)", () => {
  const HAND = { runId: "R1", subject: "Hi", message: "Hello there", offerKey: "seo" };
  it("records a protected form the operator sent themselves like a sent one", async () => {
    const d = deps({ latest: async () => run("blocked") });
    expect(await markSentByHand("L1", HAND, d)).toEqual({ ok: true });
    expect(d.updateRun).toHaveBeenCalledWith("R1", expect.objectContaining({ status: "sent", message: "Hello there", reason: "Sent by hand (the form has a CAPTCHA).", sent_at: new Date(NOW).toISOString() }));
    expect(d.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ lead_id: "L1", kind: "contact_form_sent", meta: expect.objectContaining({ run_id: "R1", by_hand: true, sent: true }) }));
    expect(d.updateLead).toHaveBeenCalledWith("L1", { stage: "outreached", inbox_status: "open" });
  });
  it("only for the newest attempt, and only when it was blocked", async () => {
    expect(await markSentByHand("L1", HAND, deps({ latest: async () => run("ready") }))).toMatchObject({ ok: false, reason: "not_blocked" });
    expect(await markSentByHand("L1", HAND, deps({ latest: async () => run("blocked", 1, { id: "R2" }) }))).toMatchObject({ ok: false, reason: "not_blocked" });
  });
  it("never moves a lead backwards", async () => {
    const d = deps({ latest: async () => run("blocked") }, { stage: "meeting_booked", inbox_status: "open" });
    await markSentByHand("L1", HAND, d);
    expect(d.updateLead).not.toHaveBeenCalled();
  });
});

describe("startLook for the automation (review fix, 24 Nov 2026)", () => {
  it("marks the attempt as automatic when it is created, so the 10 a day always counts it", async () => {
    const d = deps({ latest: async () => null });
    await startLook("L1", { force: true, source: "auto" }, d);
    expect(d.insertRun).toHaveBeenCalledWith({ lead_id: "L1", status: "looking", source: "auto" });
  });
  it("a normal look stays as before", async () => {
    const d = deps({ latest: async () => null });
    await startLook("L1", {}, d);
    expect(d.insertRun).toHaveBeenCalledWith({ lead_id: "L1", status: "looking" });
  });
});


describe("look then send (Send email → Contact page / Both, 25 Nov 2026)", () => {
  const MSG = { subject: "A website for Joe's", message: "Hi there, …", offerKey: "website_build", senderEmail: "grace@rp.rateupdigital.com" };
  it("starts a fresh look carrying the message to send", async () => {
    const d = deps({ latest: async () => null });
    const r = await startLookThenSend("L1", MSG, d);
    expect(r).toMatchObject({ ok: true });
    expect(d.insertRun).toHaveBeenCalledOnce();
    expect(d.updateRun).toHaveBeenCalledWith(
      "R1",
      expect.objectContaining({ subject: "A website for Joe's", message: "Hi there, …", offer_key: "website_build", sender_email: "grace@rp.rateupdigital.com" }),
    );
  });
  it("refuses up front when the kill switch is on or the message is empty (nothing started)", async () => {
    const d = deps({ paused: () => true });
    expect(await startLookThenSend("L1", MSG, d)).toMatchObject({ ok: false, reason: "paused" });
    expect(await startLookThenSend("L1", { ...MSG, message: " " }, deps())).toMatchObject({ ok: false, reason: "empty" });
    expect(d.insertRun).not.toHaveBeenCalled();
  });
  it("after the look: a fillable form is sent once with the saved message", async () => {
    let status: RunStatus = "looking";
    const d = deps({
      latest: async () => run(status),
      getRun: async () => run(status, 1, { subject: MSG.subject, message: MSG.message, offer_key: MSG.offerKey }),
      look: vi.fn(async () => ({ status: "ready" as const, contactUrl: "https://joes.com/contact", shot: Buffer.from("x"), reason: null })),
      updateRun: vi.fn(async (_id: string, patch: Partial<FormRun>) => {
        if (patch.status) status = patch.status as RunStatus;
      }),
      claimSend: vi.fn(async (_id, _lead, patch) => {
        status = "sending";
        return { ...run("sending"), ...patch };
      }),
      send: vi.fn(async () => ({ outcome: "sent" as const, reason: null, fields: [], filledShot: null, resultShot: null, usage: { input_tokens: 1, output_tokens: 1 } })),
    });
    await runLookThenSendStep("R1", d);
    expect(d.claimSend).toHaveBeenCalledWith("R1", "L1", expect.objectContaining({ subject: MSG.subject, message: MSG.message }));
    expect(d.send).toHaveBeenCalledOnce();
  });
  it("after the look: no form / a CAPTCHA → nothing is sent (the window shows why)", async () => {
    const d = deps({ getRun: async () => run("blocked"), send: vi.fn(), claimSend: vi.fn() });
    await runLookThenSendStep("R1", d);
    expect(d.claimSend).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });
});
