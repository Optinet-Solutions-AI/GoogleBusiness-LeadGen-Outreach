import { describe, it, expect } from "vitest";
import { routeCallResult, classifyDialRefusal } from "./route-result";

describe("routeCallResult", () => {
  it("goal reached → qualified, final, stops the sequence and hands off", () => {
    const r = routeCallResult({ status: "completed", goalReached: true, outcome: "not_interested" });
    expect(r).toMatchObject({
      final: true, memberStatus: "interested", callStatus: "qualified",
      event: "call_qualified", stopSequence: true, handoff: true, outcome: "interested",
    });
  });
  it("a voicemail never qualifies, even if goalReached is somehow true", () => {
    const r = routeCallResult({ status: "completed", goalReached: true, voicemail: true });
    expect(r.callStatus).toBe("voicemail");
    expect(r.final).toBe(false);
    expect(r.handoff).toBe(false);
  });
  it("said no → final, not re-queued, stops the sequence", () => {
    for (const outcome of ["not_interested", "declined_offer"]) {
      const r = routeCallResult({ status: "completed", goalReached: false, outcome });
      expect(r).toMatchObject({ final: true, memberStatus: "done", callStatus: "not_interested", stopSequence: true, handoff: false });
    }
  });
  it("wrong number → final bad_number", () => {
    const r = routeCallResult({ status: "completed", outcome: "wrong_number" });
    expect(r).toMatchObject({ final: true, callStatus: "bad_number", event: "call_bad_number" });
  });
  it("no answer / busy / voicemail / failed / unknown → retryable", () => {
    expect(routeCallResult({ status: "no_answer" })).toMatchObject({ final: false, retry: true, callStatus: "no_answer" });
    expect(routeCallResult({ status: "busy" })).toMatchObject({ final: false, attemptStatus: "busy", callStatus: "no_answer" });
    expect(routeCallResult({ status: "voicemail" })).toMatchObject({ final: false, callStatus: "voicemail" });
    expect(routeCallResult({ status: "failed" })).toMatchObject({ final: false, callStatus: "failed" });
    expect(routeCallResult({ status: "unknown" })).toMatchObject({ final: false, attemptStatus: "unknown", callStatus: "unknown" });
    expect(routeCallResult({ status: "completed", outcome: "unreached" })).toMatchObject({ final: false, callStatus: "no_answer" });
  });
  it("a conversation with an unrouted label is final but not a handoff", () => {
    const r = routeCallResult({ status: "completed", goalReached: false, outcome: "sent_sms" });
    expect(r).toMatchObject({ final: true, memberStatus: "done", callStatus: "completed", handoff: false });
  });
});

describe("classifyDialRefusal", () => {
  it("suppressed → skip + suppress; invalid_phone → skip", () => {
    expect(classifyDialRefusal("suppressed", 409)).toEqual({ kind: "skip_lead", callStatus: "dnc", suppress: true });
    expect(classifyDialRefusal("invalid_phone", 400)).toEqual({ kind: "skip_lead", callStatus: "bad_number", suppress: false });
  });
  it("quota / window / busy / 503 end the tick without counting an attempt", () => {
    for (const [code, status] of [
      ["busy", 429], ["daily_cap_reached", 429], ["outside_call_window", 429],
      ["dnc_unverifiable", 503], ["db_error", 503], ["quota_unverifiable", 503],
    ] as const) {
      expect(classifyDialRefusal(code, status)).toEqual({ kind: "end_tick" });
    }
  });
  it("misconfiguration aborts", () => {
    for (const code of ["campaign_unusable", "unauthorized", "bad_request", "not_configured"]) {
      expect(classifyDialRefusal(code, 409).kind).toBe("abort");
    }
  });
  it("provider errors and lost responses count as attempts (never an instant re-dial)", () => {
    expect(classifyDialRefusal("provider_error", 502)).toEqual({ kind: "attempt_failed", attemptStatus: "failed" });
    expect(classifyDialRefusal("network_error", 0)).toEqual({ kind: "attempt_failed", attemptStatus: "unknown" });
  });
  it("already_in_progress moves on to the next lead", () => {
    expect(classifyDialRefusal("already_in_progress", 409)).toEqual({ kind: "next_lead", retryMinutes: 60 });
  });
});
