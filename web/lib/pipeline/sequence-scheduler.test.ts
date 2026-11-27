/**
 * sequence-scheduler.test.ts — lock the follow-up safety rules:
 *  - we only ADVANCE the ladder when an email actually went out
 *  - a held send (pause/cap) DEFERS (no advance)
 *  - a real send failure FAILS (caller stops the ladder — never follow up)
 *  - advanceState schedules +4 days, and completes after step 4
 */

import { describe, it, expect } from "vitest";
import { planStepMeta, campaignDailyLimit, batchPlanGuard, stageAfterFirstEmail, classifySendOutcome, advanceState, isSignalLead, type SeqLeadRow } from "./sequence-scheduler";

describe("classifySendOutcome — never advance on a non-send", () => {
  it("advances on a real send", () => {
    expect(classifySendOutcome({ sent: true, noop: false })).toBe("advance");
  });

  it("advances on a $0 soft no-op (no mailbox connected, dev/test)", () => {
    expect(classifySendOutcome({ sent: true, noop: true })).toBe("advance");
    expect(classifySendOutcome({ sent: false, noop: true })).toBe("advance");
  });

  it("DEFERS (no advance) when paused or capped", () => {
    expect(classifySendOutcome({ sent: false, reason: "paused" })).toBe("defer");
    expect(classifySendOutcome({ sent: false, reason: "capped" })).toBe("defer");
  });

  it("FAILS (stop, never follow up) on a real send failure", () => {
    expect(classifySendOutcome({ sent: false, error: "550 rejected" } as never)).toBe("fail");
    expect(classifySendOutcome({ sent: false })).toBe("fail");
  });
});

describe("advanceState", () => {
  it("keeps the ladder active and schedules the next step ~4 days out for steps 1-3", () => {
    for (const step of [1, 2, 3] as const) {
      const p = advanceState(step);
      expect(p.seq_step).toBe(step);
      expect(p.seq_status).toBeUndefined(); // stays 'active'
      expect(typeof p.seq_next_step_at).toBe("string");
      expect(new Date(p.seq_next_step_at as string).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("completes after step 4 with no next step", () => {
    const p = advanceState(4);
    expect(p.seq_step).toBe(4);
    expect(p.seq_status).toBe("completed");
    expect(p.seq_next_step_at).toBeNull();
  });
});

describe("isSignalLead (closure / exhibitor leads never join the website / AI-services sequence)", () => {
  const base = { call_segment: null, website_kind: "real", needs_improvement: false } as unknown as SeqLeadRow;
  it("catches signal leads even when call_segment was never set", () => {
    expect(isSignalLead({ ...base, signal_type: "closure" })).toBe(true);
    expect(isSignalLead({ ...base, signal_type: "exhibitor" })).toBe(true);
    expect(isSignalLead({ ...base, signal_type: "unspecified" })).toBe(true);
  });
  it("catches an operator-set liquidation / exhibitor segment", () => {
    expect(isSignalLead({ ...base, call_segment: "liquidation" })).toBe(true);
    expect(isSignalLead({ ...base, call_segment: "exhibitor" })).toBe(true);
  });
  it("leaves normal Google Maps leads alone", () => {
    expect(isSignalLead({ ...base, signal_type: null })).toBe(false);
    expect(isSignalLead({ ...base, call_segment: "no_website", website_kind: "none" })).toBe(false);
  });
});

describe("isSignalLead — review-site leads", () => {
  it("keeps them out of the website / AI-services sequence", () => {
    const base = { call_segment: null, website_kind: "real", needs_improvement: false } as unknown as SeqLeadRow;
    expect(isSignalLead({ ...base, signal_type: "review_site" })).toBe(true);
  });
});

describe("planStepMeta (a batch email's send is labelled for the scoreboard, 24 Nov 2026)", () => {
  it("the first email carries what it was and its campaign; it isn't marked as a follow-up", () =>
    expect(planStepMeta({ subject: "s", body: "b", campaign_id: "c1", used: { key: "service:seo", label: "SEO", edited: false } }, 1, 1)).toEqual({
      email_used: { key: "service:seo", label: "SEO", edited: false },
      campaign_id: "c1",
    }));
  it("a follow-up is marked as one (Send email's own plans too)", () => {
    expect(planStepMeta({ subject: "Re: s", body: "f", campaign_id: "c1" }, 2, 3)).toEqual({ follow_up: true, campaign_id: "c1" });
    expect(planStepMeta({ subject: "Re: s", body: "f" }, 2, 2)).toEqual({ follow_up: true });
  });
  it("the classic sequence adds nothing", () => expect(planStepMeta(null, 1, null)).toEqual({}));
});

describe("campaignDailyLimit (a batch email's first emails stay within its daily limit)", () => {
  it("only for a batch email's first email with a limit", () => {
    expect(campaignDailyLimit({ subject: "s", body: "b", campaign_id: "c1", daily_limit: 10 }, 1)).toEqual({ campaignId: "c1", limit: 10 });
    expect(campaignDailyLimit({ subject: "s", body: "b", campaign_id: "c1", daily_limit: 10 }, 2)).toBeNull();
    expect(campaignDailyLimit({ subject: "s", body: "b" }, 1)).toBeNull();
    expect(campaignDailyLimit(null, 1)).toBeNull();
  });
});

describe("batchPlanGuard (review fixes, 24 Nov 2026)", () => {
  const ok = { step: 1, stage: "enriched", emailedBefore: false, senderActive: true, senderRoom: 5 };
  it("lets a normal first email through", () => expect(batchPlanGuard(ok)).toBeNull());
  it("drops a lead someone already emailed (e.g. with Send email after the batch started)", () =>
    expect(batchPlanGuard({ ...ok, emailedBefore: true })).toEqual({ stop: "already_emailed" }));
  it("drops a lead moved past first contact on the CRM board", () => {
    expect(batchPlanGuard({ ...ok, stage: "meeting_booked" })).toEqual({ stop: "reply_or_suppressed" });
    expect(batchPlanGuard({ ...ok, stage: "dead" })).toEqual({ stop: "reply_or_suppressed" });
  });
  it("drops a lead whose mailbox was removed, instead of a fake 'sent'", () =>
    expect(batchPlanGuard({ ...ok, senderActive: false })).toEqual({ stop: "sender_removed" }));
  it("holds a lead whose mailbox is at today's limit (without stopping the other leads)", () =>
    expect(batchPlanGuard({ ...ok, senderRoom: 0 })).toEqual({ hold: true }));
  it("a follow-up isn't stopped by the earlier email", () => expect(batchPlanGuard({ ...ok, step: 2, emailedBefore: true })).toBeNull());
});

describe("stageAfterFirstEmail", () => {
  it("moves an early lead to outreached", () => {
    expect(stageAfterFirstEmail("enriched")).toBe("outreached");
    expect(stageAfterFirstEmail(null)).toBe("outreached");
  });
  it("never moves a lead backwards", () => {
    expect(stageAfterFirstEmail("meeting_booked")).toBeNull();
    expect(stageAfterFirstEmail("outreached")).toBeNull();
  });
});

describe("batchPlanGuard with a paused mailbox (auto-pause review, 27 Nov 2026)", () => {
  const base = { step: 2, stage: "outreached", emailedBefore: true, senderActive: false, senderRoom: 0 };
  it("a paused mailbox holds the lead (Resume brings it back), it isn't stopped", () => {
    expect(batchPlanGuard({ ...base, senderPaused: true })).toEqual({ hold: true });
  });
  it("a removed mailbox still stops it", () => {
    expect(batchPlanGuard({ ...base, senderPaused: false })).toEqual({ stop: "sender_removed" });
    expect(batchPlanGuard(base)).toEqual({ stop: "sender_removed" });
  });
});
