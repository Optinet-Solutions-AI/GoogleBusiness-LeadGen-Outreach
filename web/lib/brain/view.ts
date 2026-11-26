/**
 * brain/view.ts — what the Brain page says about a job: its status in plain words, the plan's totals, the progress.
 * Pure (safe in client components).
 *
 * Inputs:  a job (status, notice, spend, budget), the plan rows, the operator's ticks
 * Outputs: statusText, planTotals (what Approve would start), progressOf (what has happened so far), spendText
 * Used by: components/brain/{BrainClient,JobView,PlanTable}.tsx
 */
import type { Channel, JobStatus } from "./rules";

export interface ViewJob {
  status: JobStatus;
  notice: string | null;
  spent_usd: number;
  settings: { budgetUsd: number };
}

export interface ViewRow {
  lead_id: string;
  decision: "contact" | "skip";
  channels: Channel[];
  allowed_channels: Channel[];
  approved: boolean;
  form_state: string | null;
  call_state: string | null;
  outcome: string | null;
}

/** One operator tick-set for a row of the plan table. */
export interface RowPick {
  approved: boolean;
  channels: Channel[];
  offer: string | null;
}

const STATUS: Record<JobStatus, string> = {
  asking: "Waiting for your answers",
  searching: "Searching for leads…",
  planning: "Judging each lead…",
  review: "Plan ready: check it and approve",
  running: "Running by itself",
  paused: "Paused",
  done: "Finished",
  cancelled: "Cancelled",
  failed: "Stopped: something went wrong",
};

/** The job's status for a person; a pause at the budget says so. */
export function statusText(job: ViewJob): string {
  if (job.status === "paused" && job.notice?.startsWith("Budget reached")) return "Paused: budget reached";
  return STATUS[job.status];
}

export const isWorking = (status: JobStatus): boolean => status === "searching" || status === "planning";
export const isLive = (status: JobStatus): boolean => status === "running" || status === "paused";

export function spendText(job: ViewJob): string {
  return `$${job.spent_usd.toFixed(2)} spent of $${job.settings.budgetUsd.toFixed(2)}`;
}

/** What pressing Approve would start: only ticked rows, and only their ticked channels. */
export function planTotals(rows: ViewRow[], picks: Record<string, RowPick>): { leads: number; emails: number; forms: number; calls: number; skipped: number } {
  const t = { leads: 0, emails: 0, forms: 0, calls: 0, skipped: 0 };
  for (const r of rows) {
    const p = picks[r.lead_id];
    const channels = (p?.channels ?? []).filter((c) => r.allowed_channels.includes(c));
    if (!p?.approved || !channels.length) {
      t.skipped++;
      continue;
    }
    t.leads++;
    if (channels.includes("email")) t.emails++;
    if (channels.includes("form")) t.forms++;
    if (channels.includes("call")) t.calls++;
  }
  return t;
}

const AI_VERDICT: Record<string, string> = { good_website: "Good website", old_website: "Old website", no_website: "No website" };

/**
 * The plan's Website column: the AI website check's verdict when there is one, else what the scrape found (a batch made
 * before the AI check, QA 26 Nov 2026: every row showed "—"). `segment` = the lead's resolved segment.
 */
export function siteLabel(verdict: string | null | undefined, segment: string | null | undefined): string {
  if (verdict && AI_VERDICT[verdict]) return AI_VERDICT[verdict];
  if (segment === "has_website") return "Has a website (not checked by AI)";
  if (segment === "old_website") return "Old website (not checked by AI)";
  if (segment === "no_website") return "No website";
  return "—";
}

/** What Approve sends: only the ticked rows (an unticked row is "not approved" on the server anyway). */
export function approvePayload(rows: ViewRow[], picks: Record<string, RowPick>): { leadId: string; approved: true; channels: Channel[]; offer: string | null }[] {
  return rows
    .filter((r) => picks[r.lead_id]?.approved)
    .map((r) => ({ leadId: r.lead_id, approved: true as const, channels: picks[r.lead_id].channels.filter((c) => r.allowed_channels.includes(c)), offer: picks[r.lead_id].offer }));
}

/** The ticks the page starts from: what the Brain decided. */
export function initialPicks(rows: (ViewRow & { offer: string | null })[]): Record<string, RowPick> {
  return Object.fromEntries(rows.map((r) => [r.lead_id, { approved: r.approved, channels: r.channels, offer: r.offer }]));
}

/** What has happened so far in a running job. */
export function progressOf(rows: ViewRow[]): { leads: number; open: number; wins: number; stopped: number; formsSent: number; needsPerson: number; callsQueued: number } {
  const mine = rows.filter((r) => r.approved);
  return {
    leads: mine.length,
    open: mine.filter((r) => !r.outcome).length,
    wins: mine.filter((r) => r.outcome === "win").length,
    stopped: mine.filter((r) => r.outcome === "stopped").length,
    formsSent: mine.filter((r) => r.form_state === "sent").length,
    needsPerson: mine.filter((r) => r.form_state === "needs_person").length,
    callsQueued: mine.filter((r) => r.call_state === "queued").length,
  };
}
