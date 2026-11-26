/**
 * leads/outreach-marks.ts — what we already sent a lead, for the Leads list row (26 Nov 2026). Pure.
 *
 * Inputs:  the leads' email_sent events (lead_id, created_at) and contact_form_runs (status, times), the time
 * Outputs: Map<lead id, OutreachMark> (emails sent + last date, newest contact form attempt) and its plain labels
 * Used by: lib/leads/outreach-marks-load.ts (loads the rows), components/LeadsTable.tsx (the "Reach out" column),
 *          components/leads/ContactFormStatus.tsx (the lead page's contact form line)
 *
 * The operator asked to see on the Leads page which leads were already emailed, and where a contact form send stands
 * without opening its window. No client-only formatting here: dates are written in UTC so the server and the browser
 * render the same text.
 */
import { effectiveStatus, type FormRun, type RunStatus } from "@/lib/contact-form/rules";

export interface OutreachMark {
  emails: number;
  lastEmailAt: string | null;
  /** The newest contact form attempt that matters (a plain look that was never sent from is left out). */
  form: { status: RunStatus; at: string } | null;
}

export type MarkRun = Pick<FormRun, "lead_id" | "status" | "created_at" | "updated_at" | "sent_at" | "message">;

export function buildOutreachMarks(
  emails: { lead_id: string; created_at: string }[],
  runs: MarkRun[],
  now: number = Date.now(),
): Map<string, OutreachMark> {
  const out = new Map<string, OutreachMark>();
  const mark = (id: string) => {
    let m = out.get(id);
    if (!m) out.set(id, (m = { emails: 0, lastEmailAt: null, form: null }));
    return m;
  };
  for (const e of emails) {
    const m = mark(e.lead_id);
    m.emails += 1;
    if (!m.lastEmailAt || e.created_at > m.lastEmailAt) m.lastEmailAt = e.created_at;
  }
  const newest = new Map<string, MarkRun>();
  for (const r of runs) {
    const cur = newest.get(r.lead_id);
    if (!cur || r.created_at > cur.created_at) newest.set(r.lead_id, r);
  }
  for (const r of newest.values()) {
    const status = effectiveStatus(r as FormRun, now);
    // "ready" with no message = someone only looked at the form: nothing was sent or tried.
    if (status === "ready") continue;
    mark(r.lead_id).form = { status, at: r.sent_at ?? r.updated_at };
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25 Nov" (UTC, so server and browser agree); "" for a bad date. */
export function shortDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function emailMarkLabel(m: OutreachMark): string | null {
  if (!m.emails || !m.lastEmailAt) return null;
  const day = shortDay(m.lastEmailAt);
  return m.emails === 1 ? `Emailed ${day}` : `Emailed ${m.emails}× · last ${day}`;
}

export type MarkTone = "positive" | "warning" | "urgent" | "neutral";

const FORM_LABEL: Partial<Record<RunStatus, { label: string; tone: MarkTone; active: boolean }>> = {
  looking: { label: "Form: opening their page…", tone: "neutral", active: true },
  sending: { label: "Form: AI is filling it…", tone: "neutral", active: true },
  sent: { label: "Form sent", tone: "positive", active: false },
  blocked: { label: "Form needs you", tone: "warning", active: false },
  unknown: { label: "Form: check their page", tone: "warning", active: false },
  failed: { label: "Form not sent", tone: "urgent", active: false },
  cancelled: { label: "Form cancelled", tone: "neutral", active: false },
  no_form: { label: "No contact form", tone: "neutral", active: false },
};

/** The short label for a contact form attempt; null for one that isn't worth a mark. `active` = still running. */
export function formMarkLabel(status: RunStatus): { label: string; tone: MarkTone; active: boolean } | null {
  return FORM_LABEL[status] ?? null;
}
