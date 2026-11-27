/**
 * email/mailbox-health.ts — when a sending mailbox should be paused: its hard bounces and spam complaints over the
 * last 7 days (27 Nov 2026). Pure.
 *
 * Inputs:  the time, the mailbox's last Resume, its sends (email_messages outbound) and the leads' hard bounces /
 *          spam complaints (outreach_events)
 * Outputs: windowStart · tallyMailbox (sends, bounces, complaints in the window) · healthVerdict (pause + the reason in
 *          plain words) · windowDays
 * Used by: lib/email/mailbox-health-run.ts (the automation tick's "mailboxHealth" part)
 *
 * Rules (spec docs/superpowers/specs/2026-11-27-mailbox-auto-pause-design.md): a bounce / complaint belongs to the
 * mailbox that sent that lead's last email before it; each lead counts once per kind; the window starts 7 days ago or
 * at the last Resume, whichever is later, so a resumed mailbox isn't paused again by the same old bounces.
 */

export const HEALTH = { windowDays: 7, minSends: 20, bounceRate: 0.05, minBounces: 2, maxComplaints: 2 } as const;

const DAY_MS = 86_400_000;

export interface HealthSend {
  lead_id: string;
  /** The mailbox address that sent it (any case). */
  from: string;
  at: string;
}

export interface HealthEvent {
  lead_id: string;
  /** Hard bounces only (soft bounces are temporary and never reach here). */
  kind: "bounce" | "complaint";
  at: string;
}

export interface MailboxTally {
  sent: number;
  bounces: number;
  complaints: number;
}

export function windowStart(now: Date, resumedAt: string | null): Date {
  const week = now.getTime() - HEALTH.windowDays * DAY_MS;
  const resumed = resumedAt ? Date.parse(resumedAt) : NaN;
  return new Date(Number.isFinite(resumed) ? Math.max(week, resumed) : week);
}

export function windowDays(now: Date, since: Date): number {
  return Math.max(1, Math.round((now.getTime() - since.getTime()) / DAY_MS));
}

export function tallyMailbox(email: string, since: Date, sends: HealthSend[], events: HealthEvent[]): MailboxTally {
  const me = email.trim().toLowerCase();
  const from = since.getTime();
  const sent = sends.filter((s) => s.from.trim().toLowerCase() === me && Date.parse(s.at) >= from).length;

  // Each lead's sends, oldest first, to find who sent the last email before an event.
  const byLead = new Map<string, { from: string; t: number }[]>();
  for (const s of sends) {
    const list = byLead.get(s.lead_id) ?? [];
    list.push({ from: s.from.trim().toLowerCase(), t: Date.parse(s.at) });
    byLead.set(s.lead_id, list);
  }
  const bounced = new Set<string>();
  const complained = new Set<string>();
  for (const e of events) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t) || t < from) continue;
    const before = (byLead.get(e.lead_id) ?? []).filter((s) => s.t <= t);
    if (!before.length) continue; // nothing we sent explains it
    const last = before.reduce((a, b) => (b.t >= a.t ? b : a));
    if (last.from !== me) continue;
    (e.kind === "bounce" ? bounced : complained).add(e.lead_id);
  }
  return { sent, bounces: bounced.size, complaints: complained.size };
}

export function healthVerdict(t: MailboxTally, days: number): { pause: false } | { pause: true; reason: string } {
  if (t.complaints >= HEALTH.maxComplaints) {
    return { pause: true, reason: `${t.complaints} spam complaint${t.complaints === 1 ? "" : "s"} in the last ${days} days` };
  }
  if (t.sent >= HEALTH.minSends && t.bounces >= HEALTH.minBounces && t.bounces / t.sent >= HEALTH.bounceRate) {
    return { pause: true, reason: `${t.bounces} hard bounces out of ${t.sent} emails in the last ${days} days (${Math.round((t.bounces / t.sent) * 100)}%)` };
  }
  return { pause: false };
}
