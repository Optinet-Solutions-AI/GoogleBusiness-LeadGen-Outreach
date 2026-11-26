import { describe, expect, it } from "vitest";
import { initialPicks, planTotals, progressOf, spendText, statusText, type ViewJob, type ViewRow } from "./view";
import type { JobStatus } from "./rules";

const job = (status: JobStatus, over: Partial<ViewJob> = {}): ViewJob => ({ status, notice: null, spent_usd: 3.1, settings: { budgetUsd: 20 }, ...over });
const row = (lead_id: string, over: Partial<ViewRow & { offer: string | null }> = {}): ViewRow & { offer: string | null } => ({
  lead_id, decision: "contact", channels: ["email", "form", "call"], allowed_channels: ["email", "form", "call"], approved: true,
  form_state: null, call_state: null, outcome: null, offer: "website_build", ...over,
});

describe("statusText", () => {
  it("says each status in plain words", () => {
    expect(statusText(job("asking"))).toBe("Waiting for your answers");
    expect(statusText(job("searching"))).toBe("Searching for leads…");
    expect(statusText(job("planning"))).toBe("Judging each lead…");
    expect(statusText(job("review"))).toBe("Plan ready: check it and approve");
    expect(statusText(job("running"))).toBe("Running by itself");
    expect(statusText(job("done"))).toBe("Finished");
    expect(statusText(job("cancelled"))).toBe("Cancelled");
    expect(statusText(job("failed"))).toBe("Stopped: something went wrong");
  });

  it("a pause at the budget says so", () => {
    expect(statusText(job("paused", { notice: "Paused by you." }))).toBe("Paused");
    expect(statusText(job("paused", { notice: "Budget reached ($19.95 of $20.00). Raise the budget to continue." }))).toBe("Paused: budget reached");
    expect(spendText(job("running"))).toBe("$3.10 spent of $20.00");
  });
});

describe("planTotals", () => {
  const rows = [row("A"), row("B"), row("C", { decision: "skip", approved: false, channels: [], allowed_channels: [] })];

  it("counts only ticked rows and their ticked channels", () => {
    const picks = initialPicks(rows);
    expect(planTotals(rows, picks)).toEqual({ leads: 2, emails: 2, forms: 2, calls: 2, skipped: 1 });
    picks.A = { ...picks.A, channels: ["email"] };
    picks.B = { ...picks.B, approved: false };
    expect(planTotals(rows, picks)).toEqual({ leads: 1, emails: 1, forms: 0, calls: 0, skipped: 2 });
  });

  it("a ticked row with no channel left, or a channel the row doesn't allow, starts nothing", () => {
    const picks = initialPicks(rows);
    picks.A = { ...picks.A, channels: [] };
    picks.C = { approved: true, channels: ["email"], offer: "website_build" };
    expect(planTotals(rows, picks)).toEqual({ leads: 1, emails: 1, forms: 1, calls: 1, skipped: 2 });
  });
});

describe("progressOf", () => {
  it("counts what happened so far", () => {
    const p = progressOf([
      row("A", { outcome: "win", form_state: "sent" }),
      row("B", { form_state: "needs_person" }),
      row("C", { call_state: "queued", form_state: "sent" }),
      row("D", { outcome: "stopped" }),
      row("E", { approved: false }),
    ]);
    expect(p).toEqual({ leads: 4, open: 2, wins: 1, stopped: 1, formsSent: 2, needsPerson: 1, callsQueued: 1 });
  });
});
