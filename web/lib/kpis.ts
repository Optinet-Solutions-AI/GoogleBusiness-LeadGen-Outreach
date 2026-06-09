/**
 * kpis.ts — Top-line business KPIs for the Metrics & Reporting band.
 *
 * Inputs:  leads / outreach_events / call_attempts rows + a time range
 * Outputs: Kpis — the 7 KPIs (leads generated, emails/phones collected,
 *          outreach volume, response rate, meetings booked, deals closed)
 * Used by: app/(dashboard)/analytics/page.tsx
 *
 * Kept separate from analytics.ts (the voice/SMS funnel) so each file does one
 * job. computeKpis() is pure + unit-tested; loadKpis() does one parallel fetch
 * and partitions in JS (fetch-then-partition, like analytics.ts / the home page).
 *
 * Period basis: acquisition KPIs (leads/emails/phones) filter by lead.created_at;
 * activity KPIs (outreach/replies) by event.created_at; outcome KPIs
 * (meetings/deals) by lead.updated_at — exact for "all", a best-effort proxy for
 * week/month since we don't store per-stage transition timestamps.
 */

export type KpiRange = "week" | "month" | "all";

export interface KpiLead {
  qualified: boolean | null;
  email: string | null;
  phone: string | null;
  stage: string | null;
  created_at: string;
  updated_at: string;
}
export interface KpiEvent {
  kind: string;
  created_at: string;
}
export interface KpiCall {
  status: string;
  created_at: string;
}

export interface Kpis {
  range: KpiRange;
  leads_generated: number;
  emails_collected: number;
  phones_collected: number;
  outreach_volume: number;
  replies: number;
  response_rate: number | null; // % (0–100, one decimal); null when no outreach yet
  meetings_booked: number;
  deals_closed: number;
  /** No outreach in range — drives the "ready to track" captions. */
  outreach_empty: boolean;
}

const MEETING_STAGES = new Set(["meeting_booked", "meeting_done"]);
const isSent = (kind: string) => kind.endsWith("_sent"); // email_sent, sms_sent
const isReply = (kind: string) => kind.includes("repl"); // replied / email_replied
const isPlacedCall = (status: string) => status !== "queued" && status !== "dialing";

/** Inclusive ISO start for the range; null = all time. */
export function rangeStart(range: KpiRange, now: Date): string | null {
  if (range === "all") return null;
  if (range === "week") {
    const day = now.getUTCDay() || 7; // Mon=1..Sun=7
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)),
    ).toISOString();
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function computeKpis(
  leads: KpiLead[],
  events: KpiEvent[],
  calls: KpiCall[],
  range: KpiRange,
  now: Date,
): Kpis {
  const start = rangeStart(range, now);
  const inRange = (iso: string | null) => start === null || (!!iso && iso >= start);

  const qualified = leads.filter((l) => l.qualified !== false);

  // Acquisition — by lead created_at.
  const acquired = qualified.filter((l) => inRange(l.created_at));
  const leads_generated = acquired.length;
  const emails_collected = acquired.filter((l) => (l.email ?? "").trim() !== "").length;
  const phones_collected = acquired.filter((l) => (l.phone ?? "").trim() !== "").length;

  // Activity — by event / attempt created_at.
  const sent = events.filter((e) => isSent(e.kind) && inRange(e.created_at)).length;
  const placedCalls = calls.filter((c) => isPlacedCall(c.status) && inRange(c.created_at)).length;
  const outreach_volume = sent + placedCalls;
  const replies = events.filter((e) => isReply(e.kind) && inRange(e.created_at)).length;
  const response_rate = outreach_volume > 0 ? +((replies / outreach_volume) * 100).toFixed(1) : null;

  // Outcomes — by lead updated_at (exact all-time; proxy for week/month).
  const meetings_booked = qualified.filter(
    (l) => MEETING_STAGES.has(l.stage ?? "") && inRange(l.updated_at),
  ).length;
  const deals_closed = qualified.filter(
    (l) => l.stage === "closed_won" && inRange(l.updated_at),
  ).length;

  return {
    range,
    leads_generated,
    emails_collected,
    phones_collected,
    outreach_volume,
    replies,
    response_rate,
    meetings_booked,
    deals_closed,
    outreach_empty: outreach_volume === 0,
  };
}
