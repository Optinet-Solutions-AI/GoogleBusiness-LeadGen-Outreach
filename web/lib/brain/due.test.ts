import { describe, expect, it } from "vitest";
import { callDue, formDue, rowFinished, stopReason, type JobLeadRow, type LeadNow } from "./due";

const NOW = Date.parse("2026-11-28T15:00:00Z");
const row = (over: Partial<JobLeadRow> = {}): JobLeadRow => ({
  job_id: "J1", lead_id: "L1", decision: "contact", offer: "website_build", channels: ["email", "form", "call"], approved: true,
  first_touch_at: "2026-11-26T15:00:00Z", form_state: "pending", call_due_at: "2026-11-28T15:00:00Z", call_state: "pending", outcome: null, ...over,
});
const lead = (over: Partial<LeadNow> = {}): LeadNow => ({ stage: "outreached", lifecycle_stage: "prospect", call_status: null, seq_status: "active", ...over });

describe("stopReason", () => {
  it("a reply or an interested call is a win", () => {
    expect(stopReason(lead({ stage: "replied" }))).toEqual({ kind: "win", reason: "They replied" });
    expect(stopReason(lead({ stage: "meeting_booked" }))?.kind).toBe("win");
    expect(stopReason(lead({ call_status: "qualified" }))).toEqual({ kind: "win", reason: "Interested on the call" });
  });

  it("unsubscribe, do-not-call, not interested, dead or lost stop everything", () => {
    expect(stopReason(lead({ lifecycle_stage: "unsubscribed" }))?.kind).toBe("stopped");
    expect(stopReason(lead({ lifecycle_stage: "dnc" }))?.kind).toBe("stopped");
    expect(stopReason(lead({ call_status: "dnc" }))?.kind).toBe("stopped");
    expect(stopReason(lead({ call_status: "not_interested" }))?.kind).toBe("stopped");
    expect(stopReason(lead({ stage: "dead" }))?.kind).toBe("stopped");
    expect(stopReason(lead({ stage: "closed_lost" }))?.kind).toBe("stopped");
  });

  it("'don't contact me' outranks an earlier reply", () => {
    expect(stopReason(lead({ stage: "replied", lifecycle_stage: "unsubscribed" }))?.kind).toBe("stopped");
  });

  it("a wrong number, an unanswered call or a sent email is not a stop", () => {
    expect(stopReason(lead({ call_status: "bad_number" }))).toBeNull();
    expect(stopReason(lead({ call_status: "no_answer" }))).toBeNull();
    expect(stopReason(lead())).toBeNull();
  });
});

describe("formDue / callDue", () => {
  it("the form is due from day 0, once, only when ticked", () => {
    expect(formDue(row(), NOW)).toBe(true);
    expect(formDue(row({ first_touch_at: "2026-11-29T15:00:00Z" }), NOW)).toBe(false);
    expect(formDue(row({ form_state: "sent" }), NOW)).toBe(false);
    expect(formDue(row({ form_state: "sending" }), NOW)).toBe(false);
    expect(formDue(row({ channels: ["email", "call"], form_state: null }), NOW)).toBe(false);
    expect(formDue(row({ approved: false }), NOW)).toBe(false);
    expect(formDue(row({ outcome: "win" }), NOW)).toBe(false);
  });

  it("the call is due 2 days after day 0, never without its tick", () => {
    expect(callDue(row(), NOW)).toBe(true);
    expect(callDue(row(), NOW - 60_000)).toBe(false);
    expect(callDue(row({ call_state: "queued" }), NOW)).toBe(false);
    expect(callDue(row({ channels: ["email", "form"], call_state: null, call_due_at: null }), NOW)).toBe(false);
    expect(callDue(row({ outcome: "stopped" }), NOW)).toBe(false);
  });
});

describe("rowFinished", () => {
  const done = row({ form_state: "sent", call_state: null, call_due_at: null, channels: ["email", "form"] });

  it("not while a form or a call is waiting, or emails are still going", () => {
    expect(rowFinished(row(), lead({ seq_status: "completed" }), NOW)).toBe(false);
    expect(rowFinished(done, lead({ seq_status: "active" }), NOW)).toBe(false);
    expect(rowFinished(done, lead({ seq_status: "completed" }), NOW)).toBe(true);
  });

  it("a queued call keeps the lead open until it is answered or 4 days have passed", () => {
    const queued = row({ form_state: "sent", call_state: "queued", call_due_at: "2026-11-28T14:00:00Z" });
    expect(rowFinished(queued, lead({ seq_status: "completed" }), NOW)).toBe(false);
    expect(rowFinished(queued, lead({ seq_status: "completed", call_status: "completed" }), NOW)).toBe(true);
    expect(rowFinished(queued, lead({ seq_status: "completed" }), NOW + 5 * 86_400_000)).toBe(true);
  });
});
