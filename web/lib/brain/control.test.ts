/**
 * control.test.ts — Pause / Resume / Cancel / Raise budget on a Brain job.
 *
 * Inputs:  fake deps (no db)
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it, vi } from "vitest";
import { callMemberAction, controlJob, type ControlDeps } from "./control";
import type { BrainJob } from "./jobs";
import { DEFAULT_SETTINGS, type JobStatus } from "./rules";

const job = (over: Partial<BrainJob> = {}): BrainJob => ({
  id: "J1", command: "x", intent: "find_and_work", status: "running", ask: { intent: "find_and_work", niche: "plumbers", place: "Texas", countryCode: "us", count: 3, batchHint: null, missing: null },
  settings: DEFAULT_SETTINGS, batch_id: "B1", email_campaign_id: "C1", spent_usd: 5, notice: null, approved_at: "", created_at: "", updated_at: "", ...over,
});

function deps(j: BrainJob, over: Partial<ControlDeps> = {}): ControlDeps {
  return {
    getJob: vi.fn(async () => j),
    updateJob: vi.fn(async (_id, _patch, onlyIf?: JobStatus[]) => !onlyIf || onlyIf.includes(j.status)),
    setEmails: vi.fn(async () => {}),
    closeOpenRows: vi.fn(async () => ["A", "B"]),
    dropCall: vi.fn(async () => {}),
    ...over,
  };
}

describe("callMemberAction (what happens to a lead's place in the call queue)", () => {
  it("a call never dialled is removed; one already tried is skipped so it is not retried; the rest is kept", () => {
    expect(callMemberAction({ status: "pending", call_attempts: 0 })).toBe("delete");
    expect(callMemberAction({ status: "pending", call_attempts: 1 })).toBe("skip");
    expect(callMemberAction({ status: "called", call_attempts: 2 })).toBe("skip");
    expect(callMemberAction({ status: "interested", call_attempts: 1 })).toBe("keep");
    expect(callMemberAction({ status: "done", call_attempts: 1 })).toBe("keep");
    expect(callMemberAction({ status: "skipped", call_attempts: 0 })).toBe("keep");
  });
});

describe("controlJob", () => {
  it("pause holds the job and its emails", async () => {
    const d = deps(job());
    expect(await controlJob("J1", { kind: "pause" }, d)).toMatchObject({ ok: true });
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "paused" }), ["running"]);
    expect(d.setEmails).toHaveBeenCalledWith("C1", "paused");
  });

  it("pause only works on a running job", async () => {
    const d = deps(job({ status: "review" }));
    expect(await controlJob("J1", { kind: "pause" }, d)).toMatchObject({ ok: false });
    expect(d.setEmails).not.toHaveBeenCalled();
  });

  it("resume continues the job and its emails", async () => {
    const d = deps(job({ status: "paused", notice: "Paused by you." }));
    expect(await controlJob("J1", { kind: "resume" }, d)).toMatchObject({ ok: true });
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "running", notice: null }), ["paused"]);
    expect(d.setEmails).toHaveBeenCalledWith("C1", "active");
  });

  it("resume is refused while the budget is used up", async () => {
    const d = deps(job({ status: "paused", spent_usd: 19.95 }));
    const r = await controlJob("J1", { kind: "resume" }, d);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toMatch(/Raise the budget first/);
    expect(d.setEmails).not.toHaveBeenCalled();
  });

  it("raise the budget: above what was spent, and it clears the budget note", async () => {
    const d = deps(job({ status: "paused", spent_usd: 19.95, notice: "Budget reached ($19.95 of $20.00). Raise the budget to continue." }));
    expect(await controlJob("J1", { kind: "raise_budget", budgetUsd: 10 }, d)).toMatchObject({ ok: false });
    expect(await controlJob("J1", { kind: "raise_budget", budgetUsd: 40 }, d)).toMatchObject({ ok: true });
    const patch = (d.updateJob as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(patch.settings.budgetUsd).toBe(40);
    expect(patch.notice).toBeNull();
  });

  it("cancel a running job: no more emails, open leads closed, calls not yet dialled removed", async () => {
    const d = deps(job());
    expect(await controlJob("J1", { kind: "cancel" }, d)).toMatchObject({ ok: true });
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ status: "cancelled" }), ["asking", "review", "running", "paused"]);
    expect(d.updateJob).toHaveBeenCalledWith("J1", expect.objectContaining({ import_rows: null }), ["asking", "review", "running", "paused"]);
    expect(d.setEmails).toHaveBeenCalledWith("C1", "done");
    expect(d.closeOpenRows).toHaveBeenCalledWith("J1", "Job cancelled");
    expect(d.dropCall).toHaveBeenCalledTimes(2);
  });

  it("cancel before approval touches no campaign and no call", async () => {
    const d = deps(job({ status: "review", email_campaign_id: null }), { closeOpenRows: vi.fn(async () => []) });
    expect(await controlJob("J1", { kind: "cancel" }, d)).toMatchObject({ ok: true });
    expect(d.setEmails).not.toHaveBeenCalled();
    expect(d.dropCall).not.toHaveBeenCalled();
  });

  it("a finished or searching job can't be cancelled here", async () => {
    for (const status of ["done", "cancelled", "searching", "planning"] as JobStatus[]) {
      const d = deps(job({ status }));
      expect(await controlJob("J1", { kind: "cancel" }, d), status).toMatchObject({ ok: false });
    }
  });
});
