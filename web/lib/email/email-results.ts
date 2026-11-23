/**
 * email/email-results.ts — the scoreboard: which email each send used, and which got replies (24 Nov 2026).
 *
 * Inputs:  email_sent events (meta.email_used, recorded by Send email; meta.step for sequence sends) and the
 *          lead's email_reply / email_unsubscribe / email_complaint / email_bounced events
 * Outputs: usedOf(meta) · resultRows(sends, responses, since?) · testResult(testId, sends, responses)
 * Used by: lib/email/email-results-load.ts (the Templates page's Results and Wording tests)
 *
 * A reply, unsubscribe or bounce counts for the LAST email sent to that lead before it; several replies to one email
 * count once. Auto-replies never count (they're a different event). A send that didn't really go out (no mailbox,
 * meta.noop) isn't counted. Edited sends count for the email they started from (operator decision, 24 Nov 2026);
 * the row says how many were edited. Pure.
 */
import { ENOUGH_SENDS, type Variant } from "./wording-test";

export interface EmailUsed {
  key: string;
  label: string;
  version?: number | null;
  edited: boolean;
  test_id?: string | null;
  variant?: Variant | null;
}

export interface SendEvent {
  lead_id: string;
  at: string;
  meta: Record<string, unknown> | null;
}
export interface ResponseEvent {
  lead_id: string;
  at: string;
  kind: "email_reply" | "email_unsubscribe" | "email_complaint" | "email_bounced";
}

export interface ResultRow {
  key: string;
  label: string;
  sent: number;
  edited: number;
  replies: number;
  unsubscribed: number;
  bounced: number;
  /** replies / sent (0–1), null when nothing was sent */
  rate: number | null;
}

const UNTRACKED: EmailUsed = { key: "untracked", label: "Before tracking", edited: false };

/** What a send used: what Send email recorded, a sequence step, or "Before tracking". */
export function usedOf(meta: Record<string, unknown> | null): EmailUsed {
  const u = meta?.email_used;
  if (u && typeof u === "object") {
    const o = u as Record<string, unknown>;
    if (typeof o.key === "string" && typeof o.label === "string") {
      return {
        key: o.key,
        label: o.label,
        version: typeof o.version === "number" ? o.version : null,
        edited: o.edited === true,
        test_id: typeof o.test_id === "string" ? o.test_id : null,
        variant: o.variant === "A" || o.variant === "B" ? o.variant : null,
      };
    }
  }
  const step = typeof meta?.step === "number" ? meta.step : null;
  if (step) {
    return meta?.follow_up
      ? { key: `follow_up:${step - 1}`, label: `Send email follow-up ${step - 1}`, edited: false }
      : { key: `sequence:${step}`, label: `Classic sequence, email ${step}`, edited: false };
  }
  return UNTRACKED;
}

type Outcome = { send: SendEvent; used: EmailUsed; replied: boolean; unsubscribed: boolean; bounced: boolean };

/** Each real send with what came back after it (before the lead's next email). */
function outcomes(sends: SendEvent[], responses: ResponseEvent[]): Outcome[] {
  const real = sends.filter((s) => s.meta?.noop !== true);
  const byLead = new Map<string, Outcome[]>();
  for (const s of real) {
    const list = byLead.get(s.lead_id) ?? [];
    list.push({ send: s, used: usedOf(s.meta), replied: false, unsubscribed: false, bounced: false });
    byLead.set(s.lead_id, list);
  }
  for (const list of byLead.values()) list.sort((a, b) => Date.parse(a.send.at) - Date.parse(b.send.at));
  for (const r of responses) {
    const list = byLead.get(r.lead_id);
    if (!list) continue;
    const at = Date.parse(r.at);
    let last: Outcome | null = null;
    for (const o of list) if (Date.parse(o.send.at) <= at) last = o;
    if (!last) continue;
    if (r.kind === "email_reply") last.replied = true;
    else if (r.kind === "email_bounced") last.bounced = true;
    else last.unsubscribed = true;
  }
  return [...byLead.values()].flat();
}

function tally(key: string, label: string, list: Outcome[]): ResultRow {
  const sent = list.length;
  const replies = list.filter((o) => o.replied).length;
  return {
    key,
    label,
    sent,
    edited: list.filter((o) => o.used.edited).length,
    replies,
    unsubscribed: list.filter((o) => o.unsubscribed).length,
    bounced: list.filter((o) => o.bounced).length,
    rate: sent ? replies / sent : null,
  };
}

/**
 * One row per email used: most sent first, "Before tracking" last; the latest label wins (templates get renamed).
 * `since`: only sends from then on are shown; every send still takes its own replies (pass ALL sends).
 */
export function resultRows(sends: SendEvent[], responses: ResponseEvent[], since: string | null = null): ResultRow[] {
  const groups = new Map<string, Outcome[]>();
  const from = since ? Date.parse(since) : null;
  for (const o of outcomes(sends, responses)) {
    if (from !== null && Date.parse(o.send.at) < from) continue;
    const list = groups.get(o.used.key) ?? [];
    list.push(o);
    groups.set(o.used.key, list);
  }
  const rows = [...groups.entries()].map(([key, list]) => {
    const latest = list.reduce((a, b) => (Date.parse(b.send.at) >= Date.parse(a.send.at) ? b : a));
    return tally(key, latest.used.label, list);
  });
  return rows.sort((a, b) => {
    if (a.key === "untracked") return 1;
    if (b.key === "untracked") return -1;
    return b.sent - a.sent || a.label.localeCompare(b.label);
  });
}

/** Version A against version B for one wording test; `enough` once each has ENOUGH_SENDS sends. */
export function testResult(testId: string, sends: SendEvent[], responses: ResponseEvent[]): { a: ResultRow; b: ResultRow; enough: boolean } {
  const mine = outcomes(sends, responses).filter((o) => o.used.test_id === testId);
  const a = tally("A", "Version A", mine.filter((o) => o.used.variant === "A"));
  const b = tally("B", "Version B", mine.filter((o) => o.used.variant === "B"));
  return { a, b, enough: a.sent >= ENOUGH_SENDS && b.sent >= ENOUGH_SENDS };
}
