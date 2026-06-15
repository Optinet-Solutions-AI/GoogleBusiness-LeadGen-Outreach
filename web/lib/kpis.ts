/**
 * kpis.ts — Top-line business KPIs for the Metrics & Reporting band.
 *
 * Inputs:  leads / outreach_events rows + a resolved date range
 * Outputs: Kpis — the 7 KPIs (leads generated, emails/phones collected,
 *          outreach volume, response rate, meetings booked, deals closed)
 * Used by: app/(dashboard)/analytics/page.tsx (via kpis-load.ts)
 *
 * Pure + unit-tested; the server loader (kpis-load.ts) does the fetch. Range is
 * resolved from URL params into explicit [start, end] ISO bounds — presets
 * (week / month / all) or a custom from/to. Acquisition KPIs filter by lead
 * created_at; activity KPIs by event created_at; outcome KPIs (meetings/deals)
 * by lead updated_at — exact for "all", a best-effort proxy for bounded ranges.
 */

export type RangeKey = "week" | "month" | "all" | "custom";

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
export interface KpiStageEvent {
  to_stage: string;
  created_at: string;
}

/** A range resolved to inclusive ISO bounds (null = unbounded on that side). */
export interface ResolvedRange {
  key: RangeKey;
  start: string | null;
  end: string | null;
  /** YYYY-MM-DD echoed back so the custom date inputs can pre-fill. */
  from: string | null;
  to: string | null;
  label: string;
}

export interface Kpis {
  key: RangeKey;
  label: string;
  from: string | null;
  to: string | null;
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

const isSent = (kind: string) => kind.endsWith("_sent"); // email_sent, sms_sent
const isReply = (kind: string) => kind.includes("repl"); // replied / email_replied
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Resolve URL params into explicit date bounds. A valid from/to wins (custom);
 * otherwise the week / month / all preset. `now` is injected for testability.
 */
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  now: Date,
): ResolvedRange {
  const from = (params.from ?? "").trim();
  const to = (params.to ?? "").trim();
  if (isYmd(from) || isYmd(to)) {
    const f = isYmd(from) ? from : null;
    const t = isYmd(to) ? to : null;
    return {
      key: "custom",
      start: f ? `${f}T00:00:00.000Z` : null,
      end: t ? `${t}T23:59:59.999Z` : null,
      from: f,
      to: t,
      label: f && t ? `${f} → ${t}` : f ? `since ${f}` : `until ${t}`,
    };
  }
  const range = params.range === "week" || params.range === "month" ? params.range : "all";
  if (range === "all") {
    return { key: "all", start: null, end: null, from: null, to: null, label: "All time" };
  }
  const day = now.getUTCDay() || 7; // Mon=1..Sun=7
  const start =
    range === "week"
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    key: range,
    start: start.toISOString(),
    end: null,
    from: null,
    to: null,
    label: range === "week" ? "This week" : "This month",
  };
}

export function computeKpis(
  leads: KpiLead[],
  events: KpiEvent[],
  r: ResolvedRange,
  stageEvents: KpiStageEvent[] = [],
): Kpis {
  const inRange = (iso: string | null) =>
    (!r.start || (!!iso && iso >= r.start)) && (!r.end || (!!iso && iso <= r.end));

  const qualified = leads.filter((l) => l.qualified !== false);

  // Acquisition — by lead created_at.
  const acquired = qualified.filter((l) => inRange(l.created_at));
  const leads_generated = acquired.length;
  const emails_collected = acquired.filter((l) => (l.email ?? "").trim() !== "").length;
  const phones_collected = acquired.filter((l) => (l.phone ?? "").trim() !== "").length;

  // Activity — by event created_at.
  const outreach_volume = events.filter((e) => isSent(e.kind) && inRange(e.created_at)).length;
  const replies = events.filter((e) => isReply(e.kind) && inRange(e.created_at)).length;
  const response_rate = outreach_volume > 0 ? +((replies / outreach_volume) * 100).toFixed(1) : null;

  // Outcomes — counted from the stage-transition log, dated exactly by when the
  // lead entered the stage (not leads.updated_at, which any edit would bump).
  const meetings_booked = stageEvents.filter((e) => e.to_stage === "meeting_booked" && inRange(e.created_at)).length;
  const deals_closed = stageEvents.filter((e) => e.to_stage === "closed_won" && inRange(e.created_at)).length;

  return {
    key: r.key,
    label: r.label,
    from: r.from,
    to: r.to,
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
