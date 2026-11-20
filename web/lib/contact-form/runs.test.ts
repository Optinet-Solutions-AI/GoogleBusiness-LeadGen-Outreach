/**
 * runs.test.ts — "Contact form" attempts: the gates before a look / send, one submit only, and what gets recorded.
 *
 * Inputs:  fake deps (no db, no browser, no OpenAI)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import { markStartFailed, runSendStep, startLook, startSend, type FormLead, type RunsDeps } from "./runs";
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
    latest: async () => null,
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
    expect(d.updateRun).toHaveBeenCalledWith("R1", expect.objectContaining({ status: "ready" }));
  });
  it("marks a look failed", async () => {
    const d = deps();
    await markStartFailed("R1", "look", d);
    expect(d.updateRun).toHaveBeenCalledWith("R1", expect.objectContaining({ status: "failed" }));
  });
});
