/**
 * crm/timeline-merge.ts — fold five tables into one lead timeline, newest first. Pure.
 *
 * Inputs:  rows from outreach_events, lead_stage_events, email_messages, call_attempts, lead_notes
 * Outputs: TimelineItem[] sorted by time desc, each with a short human title
 * Used by: lib/crm/timeline-load.ts (server) → components/crm/CrmLeadPanel.tsx
 */

export type TimelineKind = "email_out" | "email_in" | "email_issue" | "call" | "stage" | "note" | "event";

export interface TimelineItem {
  id: string;
  ts: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
}

export interface OutreachEventRow { id: string; kind: string; meta: Record<string, unknown> | null; created_at: string }
export interface StageEventRow { id: string; from_stage: string | null; to_stage: string; created_at: string }
export interface MessageRow { id: string; direction: "outbound" | "inbound"; subject: string | null; body_snippet: string | null; body_text: string | null; status: string; created_at: string }
export interface CallRow { id: string; status: string; outcome: string | null; duration_sec: number | null; created_at: string; ended_at: string | null; meta: Record<string, unknown> | null }
export interface NoteRow { id: string; body: string; author: string | null; created_at: string }

const STAGE_LABEL: Record<string, string> = {
  scraped: "Scraped", enriched: "Enriched", generated: "Site built", deployed: "Site deployed", needs_email: "Needs email",
  outreached: "Contacted", replied: "Replied", meeting_booked: "Meeting booked", meeting_done: "Meeting done",
  improved: "Improving", handed_over: "Handed over", closed_won: "Won", closed_lost: "Lost", dead: "Dead",
};

const EVENT_TITLE: Record<string, string> = {
  email_sent: "Email sent", email_reply: "Reply received", email_bounced: "Email bounced", email_send_failed: "Email failed",
  email_unsubscribe: "Unsubscribed", email_auto_reply: "Auto-reply", sms_sent: "SMS sent", dm_sent: "DM sent",
  contact_form_filled: "Contact form (dry run)", contact_form_blocked: "Contact form blocked",
  call_placed: "AI call placed", call_qualified: "AI call: interested", call_declined: "AI call: not interested",
  call_unreached: "AI call: no answer", call_completed: "AI call done", call_bad_number: "AI call: wrong number", call_dnc: "AI call: do not call",
};

function stageLabel(s: string | null): string {
  return s ? (STAGE_LABEL[s] ?? s.replace(/_/g, " ")) : "";
}

function clip(s: string | null | undefined, n = 160): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || null;
}

export function mergeTimeline(input: {
  events?: readonly OutreachEventRow[];
  stageEvents?: readonly StageEventRow[];
  messages?: readonly MessageRow[];
  calls?: readonly CallRow[];
  notes?: readonly NoteRow[];
}): TimelineItem[] {
  const out: TimelineItem[] = [];
  // Emails come from email_messages (richer); the matching outreach_events rows would duplicate them.
  const messageKinds = new Set(["email_sent", "email_reply"]);
  const hasMessages = (input.messages?.length ?? 0) > 0;

  for (const m of input.messages ?? []) {
    const inbound = m.direction === "inbound";
    out.push({
      id: `msg:${m.id}`,
      ts: m.created_at,
      kind: inbound ? "email_in" : m.status === "failed" ? "email_issue" : "email_out",
      title: inbound ? "Reply received" : m.status === "failed" ? "Email failed" : "Email sent",
      detail: clip(m.subject ? `${m.subject} — ${m.body_snippet ?? m.body_text ?? ""}` : (m.body_snippet ?? m.body_text)),
    });
  }
  for (const e of input.events ?? []) {
    if (hasMessages && messageKinds.has(e.kind)) continue;
    if (e.kind.startsWith("call_")) continue; // call_attempts is the system of record
    const step = typeof e.meta?.step === "number" ? ` (step ${e.meta.step})` : "";
    const kind: TimelineKind = e.kind === "email_reply" ? "email_in" : e.kind === "email_sent" ? "email_out" : /bounce|failed|unsubscribe/.test(e.kind) ? "email_issue" : "event";
    out.push({ id: `ev:${e.id}`, ts: e.created_at, kind, title: (EVENT_TITLE[e.kind] ?? e.kind.replace(/_/g, " ")) + step, detail: clip(typeof e.meta?.subject === "string" ? e.meta.subject : null) });
  }
  for (const c of input.calls ?? []) {
    const bits = [c.outcome?.replace(/_/g, " ") ?? c.status.replace(/_/g, " "), c.duration_sec ? `${Math.round(c.duration_sec / 60)} min` : null].filter(Boolean);
    const summary = typeof c.meta?.summary === "string" ? c.meta.summary : null;
    out.push({ id: `call:${c.id}`, ts: c.ended_at ?? c.created_at, kind: "call", title: `AI call: ${bits.join(", ")}`, detail: clip(summary) });
  }
  for (const s of input.stageEvents ?? []) {
    out.push({ id: `stage:${s.id}`, ts: s.created_at, kind: "stage", title: s.from_stage ? `${stageLabel(s.from_stage)} → ${stageLabel(s.to_stage)}` : `Moved to ${stageLabel(s.to_stage)}`, detail: null });
  }
  for (const n of input.notes ?? []) {
    out.push({ id: `note:${n.id}`, ts: n.created_at, kind: "note", title: n.author ? `Note by ${n.author}` : "Note", detail: n.body.trim() });
  }
  return out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id.localeCompare(b.id)));
}
