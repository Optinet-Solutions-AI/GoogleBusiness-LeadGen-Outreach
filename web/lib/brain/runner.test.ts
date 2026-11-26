/**
 * runner.test.ts — a running Brain job moved forward by the automation tick: stops and wins first, then contact forms
 * and calls inside the daily numbers and the budget, each lead claimed so it can't go out twice.
 *
 * Inputs:  fake deps (no db, no browser, no Voizo)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import { runBrainJobs, type RunnerDeps } from "./runner";
import type { JobLeadRow, LeadNow } from "./due";
import type { BrainJob } from "./jobs";
import { DEFAULT_SETTINGS } from "./rules";

const NOW = Date.parse("2026-11-30T16:00:00Z");
const job = (over: Partial<BrainJob> = {}): BrainJob => ({
  id: "J1", command: "x", intent: "find_and_work", status: "running", ask: { intent: "find_and_work", niche: "plumbers", place: "Texas", countryCode: "us", count: 3, batchHint: null, missing: null },
  settings: DEFAULT_SETTINGS, batch_id: "B1", email_campaign_id: "C1", spent_usd: 1, notice: null, approved_at: "2026-11-26T15:00:00Z", created_at: "", updated_at: "2026-11-30T15:59:00Z", ...over,
});
const row = (lead_id: string, over: Partial<JobLeadRow> = {}): JobLeadRow => ({
  job_id: "J1", lead_id, decision: "contact", offer: "website_build", channels: ["email", "form", "call"], approved: true,
  first_touch_at: "2026-11-26T15:00:00Z", form_state: "pending", call_due_at: "2026-11-28T15:00:00Z", call_state: "pending", outcome: null, ...over,
});
const lead = (over: Partial<LeadNow> = {}): LeadNow => ({ stage: "outreached", lifecycle_stage: "prospect", call_status: null, seq_status: "active", ...over });

function deps(rows: JobLeadRow[], leads: Record<string, LeadNow> = {}, over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    now: () => NOW,
    killSwitch: () => false,
    jobs: vi.fn(async (statuses) => (statuses.includes("running") ? [job()] : [])),
    updateJob: vi.fn(async () => true),
    addSpend: vi.fn(async (_id, usd) => 1 + usd),
    batchStatus: vi.fn(async () => "done"),
    plan: vi.fn(async () => ({})),
    rows: vi.fn(async () => rows),
    leadsNow: vi.fn(async (ids: string[]) => new Map<string, LeadNow>(ids.map((id) => [id, leads[id] ?? lead()]))),
    setRow: vi.fn(async () => true),
    stopEmails: vi.fn(async () => {}),
    dropCall: vi.fn(async () => {}),
    pauseEmails: vi.fn(async () => {}),
    inWindow: vi.fn(async () => true),
    formsToday: vi.fn(async () => 0),
    callsToday: vi.fn(async () => 0),
    sendForm: vi.fn(async () => ({ state: "sent" as const, usd: 0.08, note: null })),
    queueCall: vi.fn(async () => ({ queued: true, message: "queued" })),
    stillRunning: vi.fn(async () => true),
    abortApproval: vi.fn(async () => {}),
    ...over,
  };
}

describe("runBrainJobs — stops and wins come first", () => {
  it("a lead that replied is a win: no form, no call, its other steps are closed", async () => {
    const d = deps([row("A")], { A: lead({ stage: "replied" }) });
    const r = await runBrainJobs(NOW, d);
    expect(r.wins).toBe(1);
    expect(d.sendForm).not.toHaveBeenCalled();
    expect(d.queueCall).not.toHaveBeenCalled();
    expect(d.setRow).toHaveBeenCalledWith("J1", "A", expect.objectContaining({ outcome: "win", outcome_reason: "They replied", form_state: "skipped", call_state: "skipped" }));
    expect(d.dropCall).toHaveBeenCalledWith("A");
  });

  it("a lead that unsubscribed is stopped: its emails stop and its queued call is removed", async () => {
    const d = deps([row("A", { call_state: "queued" })], { A: lead({ lifecycle_stage: "unsubscribed" }) });
    await runBrainJobs(NOW, d);
    expect(d.setRow).toHaveBeenCalledWith("J1", "A", expect.objectContaining({ outcome: "stopped", outcome_reason: "They unsubscribed" }));
    expect(d.stopEmails).toHaveBeenCalledWith("A", expect.any(String));
    expect(d.dropCall).toHaveBeenCalledWith("A");
    expect(d.sendForm).not.toHaveBeenCalled();
  });
});

describe("runBrainJobs — contact forms", () => {
  it("sends a due form, records it and what it cost", async () => {
    const d = deps([row("A", { channels: ["email", "form"], call_state: null, call_due_at: null })]);
    const r = await runBrainJobs(NOW, d);
    expect(r.forms).toBe(1);
    // Claimed first (pending → sending), so an overlapping run can't send it too.
    expect(d.setRow).toHaveBeenCalledWith("J1", "A", { form_state: "sending" }, { form_state: "pending" });
    expect(d.setRow).toHaveBeenCalledWith("J1", "A", expect.objectContaining({ form_state: "sent" }));
    expect(d.addSpend).toHaveBeenCalledWith("J1", 0.08);
  });

  it("sends nothing when another run already took the lead", async () => {
    const d = deps([row("A")], {}, { setRow: vi.fn(async (_j, _l, _p, onlyIf) => !onlyIf) });
    const r = await runBrainJobs(NOW, d);
    expect(r.forms).toBe(0);
    expect(r.calls).toBe(0);
    expect(d.sendForm).not.toHaveBeenCalled();
    expect(d.queueCall).not.toHaveBeenCalled();
  });

  it("at most 2 forms per run, and never past the job's forms-per-day", async () => {
    const many = ["A", "B", "C", "D"].map((id) => row(id, { channels: ["form"], call_state: null, call_due_at: null }));
    const d = deps(many);
    expect((await runBrainJobs(NOW, d)).forms).toBe(2);
    const full = deps(many, {}, { formsToday: vi.fn(async () => 10) });
    expect((await runBrainJobs(NOW, full)).forms).toBe(0);
    expect(full.sendForm).not.toHaveBeenCalled();
  });

  it("waits outside working hours and while the kill switch is on", async () => {
    const closed = deps([row("A")], {}, { inWindow: vi.fn(async () => false) });
    await runBrainJobs(NOW, closed);
    expect(closed.sendForm).not.toHaveBeenCalled();
    const killed = deps([row("A")], {}, { killSwitch: () => true });
    await runBrainJobs(NOW, killed);
    expect(killed.sendForm).not.toHaveBeenCalled();
  });

  it("a protected form goes to a person; a failed one is recorded as failed", async () => {
    const d = deps([row("A", { channels: ["form"], call_state: null, call_due_at: null })], {}, { sendForm: vi.fn(async () => ({ state: "needs_person" as const, usd: 0.02, note: "CAPTCHA" })) });
    await runBrainJobs(NOW, d);
    expect(d.setRow).toHaveBeenCalledWith("J1", "A", expect.objectContaining({ form_state: "needs_person", outcome_reason: "CAPTCHA" }));
  });

  it("never spends past the budget: the job pauses with a plain note and nothing is sent", async () => {
    const d = deps([row("A")], {}, { jobs: vi.fn(async (s) => (s.includes("running") ? [job({ spent_usd: 19.95 })] : [])) });
    const r = await runBrainJobs(NOW, d);
    expect(d.sendForm).not.toHaveBeenCalled();
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "paused", notice: "Budget reached ($19.95 of $20.00). Raise the budget to continue." }), ["running"]);
    expect(d.pauseEmails).toHaveBeenCalledWith("C1");
    expect(r.notes.join(" ")).toMatch(/budget/i);
  });
});

describe("runBrainJobs — calls", () => {
  it("queues a due call with the lead's offer, and remembers when", async () => {
    const d = deps([row("A", { channels: ["email", "call"], form_state: null })]);
    const r = await runBrainJobs(NOW, d);
    expect(r.calls).toBe(1);
    expect(d.setRow).toHaveBeenCalledWith("J1", "A", { call_state: "queued", call_due_at: new Date(NOW).toISOString() }, { call_state: "pending" });
    expect(d.queueCall).toHaveBeenCalledWith("A", "website_build");
  });

  it("never calls a lead whose ☎ wasn't ticked", async () => {
    const d = deps([row("A", { channels: ["email"], form_state: null, call_state: null, call_due_at: null })]);
    await runBrainJobs(NOW, d);
    expect(d.queueCall).not.toHaveBeenCalled();
  });

  it("respects calls-per-day", async () => {
    const d = deps([row("A", { form_state: null, channels: ["call"] })], {}, { callsToday: vi.fn(async () => 5) });
    await runBrainJobs(NOW, d);
    expect(d.queueCall).not.toHaveBeenCalled();
  });

  it("a call the queue refuses is skipped with the reason, not retried", async () => {
    const d = deps([row("A", { form_state: null, channels: ["call"] })], {}, { queueCall: vi.fn(async () => ({ queued: false, message: "An earlier call found this number wrong." })) });
    await runBrainJobs(NOW, d);
    expect(d.setRow).toHaveBeenCalledWith("J1", "A", expect.objectContaining({ call_state: "skipped", outcome_reason: "An earlier call found this number wrong." }));
  });
});

describe("runBrainJobs — finishing and repairing", () => {
  it("marks a lead done when nothing is left, and the job done when every lead is", async () => {
    const d = deps([row("A", { form_state: "sent", call_state: null, call_due_at: null, channels: ["email", "form"] })], { A: lead({ seq_status: "completed" }) });
    const r = await runBrainJobs(NOW, d);
    expect(d.setRow).toHaveBeenCalledWith("J1", "A", expect.objectContaining({ outcome: "done" }));
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "done" }), ["running"]);
    expect(r.done).toBe(1);
  });

  it("a search that finished without planning gets planned; a failed one fails the job", async () => {
    const searching = job({ status: "searching", updated_at: "2026-11-30T15:00:00Z" });
    const d = deps([], {}, { jobs: vi.fn(async (s) => (s.includes("searching") ? [searching] : [])) });
    await runBrainJobs(NOW, d);
    expect(d.plan).toHaveBeenCalledWith("J1");
    const f = deps([], {}, { jobs: vi.fn(async (s) => (s.includes("searching") ? [searching] : [])), batchStatus: vi.fn(async () => "failed") });
    await runBrainJobs(NOW, f);
    expect(f.plan).not.toHaveBeenCalled();
    expect(f.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "failed" }), ["searching"]);
  });

  it("a planning step that died (30+ minutes) is run again", async () => {
    const stuck = job({ status: "planning", updated_at: "2026-11-30T15:00:00Z" });
    const d = deps([], {}, { jobs: vi.fn(async (s) => (s.includes("planning") ? [stuck] : [])) });
    await runBrainJobs(NOW, d);
    expect(d.plan).toHaveBeenCalledWith("J1");
    const fresh = deps([], {}, { jobs: vi.fn(async (s) => (s.includes("planning") ? [job({ status: "planning", updated_at: "2026-11-30T15:55:00Z" })] : [])) });
    await runBrainJobs(NOW, fresh);
    expect(fresh.plan).not.toHaveBeenCalled();
  });

  it("a form send that never reported back (30+ minutes) is closed as failed, never sent again", async () => {
    const stuck = row("A", { channels: ["form"], form_state: "sending", call_state: null, call_due_at: null, updated_at: "2026-11-30T15:00:00Z" });
    const d = deps([stuck], { A: lead({ seq_status: "completed" }) });
    await runBrainJobs(NOW, d);
    expect(d.sendForm).not.toHaveBeenCalled();
    expect(d.setRow).toHaveBeenCalledWith("J1", "A", expect.objectContaining({ form_state: "failed", outcome_reason: expect.stringMatching(/Check their page/) }), { form_state: "sending" });
    const fresh = deps([row("A", { channels: ["form"], form_state: "sending", call_state: null, call_due_at: null, updated_at: "2026-11-30T15:55:00Z" })]);
    await runBrainJobs(NOW, fresh);
    expect(fresh.setRow).not.toHaveBeenCalledWith("J1", "A", expect.objectContaining({ form_state: "failed" }), expect.anything());
  });

  it("leaves a job alone while its approval is still being saved (never marks it finished)", async () => {
    const mid = job({ approved_at: null, updated_at: "2026-11-30T15:58:00Z" });
    const d = deps([row("A", { first_touch_at: null, form_state: null, call_state: null, call_due_at: null })], { A: lead({ seq_status: "none" }) }, { jobs: vi.fn(async (s) => (s.includes("running") ? [mid] : [])) });
    const r = await runBrainJobs(NOW, d);
    expect(d.rows).not.toHaveBeenCalled();
    expect(d.updateJob).not.toHaveBeenCalled();
    expect(r.done).toBe(0);
  });

  it("an approval that died (10+ minutes) is undone: emails stopped, back to review", async () => {
    const dead = job({ approved_at: null, updated_at: "2026-11-30T15:40:00Z" });
    const d = deps([], {}, { jobs: vi.fn(async (s) => (s.includes("running") ? [dead] : [])) });
    await runBrainJobs(NOW, d);
    expect(d.abortApproval).toHaveBeenCalledWith(dead);
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "review", notice: expect.stringMatching(/Approve it again/) }), ["running"]);
  });

  it("re-reads the job before each form and call: nothing goes out after Cancel or Pause", async () => {
    const d = deps([row("A"), row("B", { channels: ["call"], form_state: null })], {}, { stillRunning: vi.fn(async () => false) });
    const r = await runBrainJobs(NOW, d);
    expect(d.sendForm).not.toHaveBeenCalled();
    expect(d.queueCall).not.toHaveBeenCalled();
    expect(r.forms + r.calls).toBe(0);
  });

  it("one job failing never stops the others", async () => {
    const d = deps([row("A")], {}, {
      jobs: vi.fn(async (s) => (s.includes("running") ? [job({ id: "BAD" }), job()] : [])),
      rows: vi.fn(async (id) => {
        if (id === "BAD") throw new Error("db down");
        return [row("A", { channels: ["form"], call_state: null, call_due_at: null })];
      }),
    });
    const r = await runBrainJobs(NOW, d);
    expect(r.forms).toBe(1);
    expect(r.notes.join(" ")).toMatch(/BAD/);
  });
});
