/**
 * route-result.ts — pure rules: what a Voizo call result / dial refusal means for the lead.
 *
 * Inputs:  a finished Voizo call (status, outcome, goalReached, voicemail) or a refusal code
 * Outputs: the member status, leads.call_status, event kind and retry decision to apply
 * Used by: lib/pipeline/call-scheduler.ts (the only writer). Tables: workflows/call_leads_voizo.md
 *
 * goalReached = QUALIFIED, never won: a model's reading of the call, so a human follows up.
 */

export type MemberStatus = "pending" | "called" | "interested" | "done" | "skipped";

export type LeadCallStatus =
  | "qualified"
  | "not_interested"
  | "bad_number"
  | "no_answer"
  | "voicemail"
  | "failed"
  | "unknown"
  | "completed"
  | "dnc";

/** call_attempts.status (migration 045 check). */
export type AttemptStatus =
  | "completed"
  | "no_answer"
  | "busy"
  | "voicemail"
  | "failed"
  | "canceled"
  | "unknown";

/** call_attempts.outcome (migration 016 check). */
export type AttemptOutcome = "interested" | "not_interested" | "wrong_number" | "do_not_call" | null;

export type CallEventKind =
  | "call_qualified"
  | "call_declined"
  | "call_bad_number"
  | "call_unreached"
  | "call_completed"
  | "call_dnc";

export interface CallRoute {
  /** true = a final answer for this lead: never re-queue it in this campaign. */
  final: boolean;
  /** Only meaningful when !final: counts toward the attempt cap and schedules a retry. */
  retry: boolean;
  memberStatus: MemberStatus;
  callStatus: LeadCallStatus;
  attemptStatus: AttemptStatus;
  outcome: AttemptOutcome;
  event: CallEventKind;
  /** Stop the lead's email sequence (said yes or said no — either way, stop the drip). */
  stopSequence: boolean;
  /** Put the lead in the Inbox for a human follow-up. */
  handoff: boolean;
}

export interface FinishedCall {
  status?: string | null;
  outcome?: string | null;
  goalReached?: boolean | null;
  voicemail?: boolean | null;
}

const DECLINED = new Set(["not_interested", "declined_offer"]);
const ATTEMPT_STATUSES = new Set<AttemptStatus>(["completed", "no_answer", "busy", "voicemail", "failed", "canceled"]);

function attemptStatusOf(call: FinishedCall): AttemptStatus {
  if (call.voicemail) return "voicemail";
  const s = (call.status ?? "") as AttemptStatus;
  return ATTEMPT_STATUSES.has(s) ? s : "unknown";
}

/** Route a call Voizo reports as done (or one we gave up polling: pass status "unknown"). */
export function routeCallResult(call: FinishedCall): CallRoute {
  const attemptStatus = attemptStatusOf(call);
  const outcome = (call.outcome ?? "").toLowerCase();

  if (call.goalReached === true && !call.voicemail) {
    return {
      final: true, retry: false, memberStatus: "interested", callStatus: "qualified",
      attemptStatus, outcome: "interested", event: "call_qualified", stopSequence: true, handoff: true,
    };
  }
  if (DECLINED.has(outcome)) {
    return {
      final: true, retry: false, memberStatus: "done", callStatus: "not_interested",
      attemptStatus, outcome: "not_interested", event: "call_declined", stopSequence: true, handoff: false,
    };
  }
  if (outcome === "wrong_number") {
    return {
      final: true, retry: false, memberStatus: "done", callStatus: "bad_number",
      attemptStatus, outcome: "wrong_number", event: "call_bad_number", stopSequence: false, handoff: false,
    };
  }

  // A real conversation with a label we don't route (anything but "unreached"): it ended
  // without a yes or a no. Don't ring them again automatically; it's in the log for a human.
  if (attemptStatus === "completed" && outcome && outcome !== "unreached") {
    return {
      final: true, retry: false, memberStatus: "done", callStatus: "completed",
      attemptStatus, outcome: null, event: "call_completed", stopSequence: false, handoff: false,
    };
  }

  // Nobody (or a machine) picked up, the carrier failed it, or we don't know: not a rejection.
  const callStatus: LeadCallStatus =
    attemptStatus === "voicemail" ? "voicemail"
    : attemptStatus === "no_answer" || attemptStatus === "busy" ? "no_answer"
    : attemptStatus === "failed" || attemptStatus === "canceled" ? "failed"
    : attemptStatus === "completed" ? "no_answer" // connected but "unreached" / no label
    : "unknown";
  return {
    final: false, retry: true, memberStatus: "called", callStatus,
    attemptStatus, outcome: null, event: "call_unreached", stopSequence: false, handoff: false,
  };
}

export type RefusalAction =
  /** Lead can never be called: mark it and move on to the next lead. */
  | { kind: "skip_lead"; callStatus: LeadCallStatus; suppress: boolean }
  /** Lead is fine, just not now: release it (retry after `retryMinutes`) and try the next lead. */
  | { kind: "next_lead"; retryMinutes: number }
  /** Counts as a failed attempt for this lead; retry on the normal schedule. */
  | { kind: "attempt_failed"; attemptStatus: AttemptStatus }
  /** Voizo can't take a call right now: release the lead, end this tick. */
  | { kind: "end_tick" }
  /** Misconfiguration: release the lead, stop and alert a human. Retrying won't help. */
  | { kind: "abort" };

/** Decide what a refused dial POST means. `status` 0 = no HTTP response at all. */
export function classifyDialRefusal(code: string, status: number): RefusalAction {
  switch (code) {
    case "suppressed":
      return { kind: "skip_lead", callStatus: "dnc", suppress: true };
    case "invalid_phone":
      return { kind: "skip_lead", callStatus: "bad_number", suppress: false };
    case "already_in_progress":
      return { kind: "next_lead", retryMinutes: 60 };
    case "busy":
    case "daily_cap_reached":
    case "outside_call_window":
      return { kind: "end_tick" };
    case "provider_error":
      return { kind: "attempt_failed", attemptStatus: "failed" };
    case "network_error":
      // The request may have reached Voizo and dialled. Never re-dial at once.
      return { kind: "attempt_failed", attemptStatus: "unknown" };
    case "campaign_unusable":
    case "unauthorized":
    case "bad_request":
    case "not_configured":
      return { kind: "abort" };
  }
  if (status === 503 || code.endsWith("_unverifiable") || code === "db_error") return { kind: "end_tick" };
  if (status === 429) return { kind: "end_tick" };
  if (status >= 500) return { kind: "attempt_failed", attemptStatus: "failed" };
  return { kind: "abort" };
}
