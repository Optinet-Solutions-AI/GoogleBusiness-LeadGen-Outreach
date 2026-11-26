/**
 * brain/due.ts — for a running Brain job: is this lead's contact form or call due, and must we stop (26 Nov 2026). Pure.
 *
 * Inputs:  a plan row (approved channels, first touch / call times, form / call state), the lead as it is right now
 * Outputs: stopReason (win / stopped / null), formDue, callDue, rowFinished
 * Used by: lib/brain/runner.ts (every automation tick), lib/brain/view.ts (progress counts)
 *
 * The win the Brain chases is a reply: a human reply or an "interested" call stops everything else for that lead.
 * Unsubscribe, "not interested", do-not-call, dead / lost stop every channel. A wrong number is NOT a stop: only the
 * call is skipped (the call queue refuses it); a bounce only ends the emails (the sequence does that itself).
 */
import type { Channel } from "./rules";

export interface JobLeadRow {
  job_id: string;
  lead_id: string;
  decision: "contact" | "skip";
  offer: string | null;
  channels: Channel[];
  approved: boolean;
  first_touch_at: string | null;
  form_state: string | null;
  call_due_at: string | null;
  call_state: string | null;
  outcome: string | null;
  /** When the row last changed (used to spot a contact form send that never reported back). */
  updated_at?: string | null;
}

/** The lead as it is right now. */
export interface LeadNow {
  stage: string | null;
  lifecycle_stage: string | null;
  call_status: string | null;
  seq_status: string | null;
}

const WIN_STAGES = new Set(["replied", "meeting_booked", "meeting_done", "improved", "handed_over", "closed_won"]);
const DEAD_STAGES = new Set(["dead", "closed_lost"]);

/** Must this lead's remaining steps stop? A win (they answered) or a stop (they said no / asked us to stop). */
export function stopReason(l: LeadNow): { kind: "win" | "stopped"; reason: string } | null {
  // "Don't contact me" outranks everything, even an earlier reply.
  if (l.lifecycle_stage === "unsubscribed") return { kind: "stopped", reason: "They unsubscribed" };
  if (l.lifecycle_stage === "dnc" || l.call_status === "dnc") return { kind: "stopped", reason: "They asked not to be contacted" };
  if (l.call_status === "not_interested") return { kind: "stopped", reason: "Not interested (said so on the call)" };
  if (l.stage && DEAD_STAGES.has(l.stage)) return { kind: "stopped", reason: "Marked dead or lost" };
  if (l.call_status === "qualified") return { kind: "win", reason: "Interested on the call" };
  if (l.stage && WIN_STAGES.has(l.stage)) return { kind: "win", reason: "They replied" };
  return null;
}

const open = (row: JobLeadRow) => row.approved && !row.outcome;

/** The contact form is due: ticked, still pending, and its day 0 has come. */
export function formDue(row: JobLeadRow, now: number): boolean {
  return open(row) && row.channels.includes("form") && row.form_state === "pending" && !!row.first_touch_at && Date.parse(row.first_touch_at) <= now;
}

/** The call is due: ticked, still pending, and 2 days have passed since day 0. */
export function callDue(row: JobLeadRow, now: number): boolean {
  return open(row) && row.channels.includes("call") && row.call_state === "pending" && !!row.call_due_at && Date.parse(row.call_due_at) <= now;
}

/** How long a queued call may still be trying (3 attempts, hours apart, weekends) before the row counts as finished. */
export const CALL_SETTLE_DAYS = 4;

/**
 * Nothing left to do for this lead: no form waiting or running, no call waiting, its emails are over, and a queued
 * call has had its answer (or its days). After a call is queued, `call_due_at` holds when it was queued.
 */
export function rowFinished(row: JobLeadRow, lead: LeadNow, now: number): boolean {
  if (row.form_state === "pending" || row.form_state === "sending") return false;
  if (row.call_state === "pending") return false;
  if (lead.seq_status === "active" || lead.seq_status === "paused") return false;
  if (row.call_state === "queued") {
    const answered = lead.call_status === "completed" || lead.call_status === "bad_number";
    const queuedAt = row.call_due_at ? Date.parse(row.call_due_at) : 0;
    if (!answered && now - queuedAt < CALL_SETTLE_DAYS * 86_400_000) return false;
  }
  return true;
}
