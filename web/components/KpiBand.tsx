/**
 * KpiBand.tsx — the "Key Performance Indicators" band on the Analytics page.
 *
 * Inputs:  Kpis (from lib/kpis.loadKpis) — carries the active range
 * Outputs: a period toggle (week / month / all) + 7 KPI cards
 * Used by: app/(dashboard)/analytics/page.tsx
 *
 * Display-only. The period pills are <Link>s that set ?range=… so the server
 * component re-renders with the new range — no client state.
 */

import Link from "next/link";
import { MetricCard } from "./MetricCard";
import type { Kpis, KpiRange } from "@/lib/kpis";

const RANGES: { key: KpiRange; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

export function KpiBand({ kpis }: { kpis: Kpis }) {
  const { range } = kpis;
  const pctOfLeads = (n: number) =>
    kpis.leads_generated > 0 ? `${Math.round((n / kpis.leads_generated) * 100)}% of leads` : undefined;
  // Outcome KPIs are exact all-time; week/month leans on updated_at (a proxy).
  const approx = range === "all" ? undefined : "approx · by last update";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">Key performance indicators</p>
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => {
            const active = r.key === range;
            return (
              <Link
                key={r.key}
                href={r.key === "all" ? "/analytics" : `/analytics?range=${r.key}`}
                className={[
                  "px-3 py-1.5 rounded text-[11px] uppercase tracking-[0.14em] font-semibold font-mono transition-colors border",
                  active
                    ? "bg-ink text-canvas border-ink"
                    : "bg-surface text-ink-muted border-rule hover:bg-surface-alt hover:text-ink",
                ].join(" ")}
              >
                {r.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard eyebrow="Leads generated" value={kpis.leads_generated.toLocaleString()} href="/leads" />
        <MetricCard
          eyebrow="Emails collected"
          value={kpis.emails_collected.toLocaleString()}
          caption={pctOfLeads(kpis.emails_collected)}
        />
        <MetricCard
          eyebrow="Phone numbers"
          value={kpis.phones_collected.toLocaleString()}
          caption={pctOfLeads(kpis.phones_collected)}
        />
        <MetricCard
          eyebrow="Outreach volume"
          value={kpis.outreach_volume.toLocaleString()}
          caption={kpis.outreach_empty ? "ready to track" : "emails + SMS + calls"}
        />
        <MetricCard
          eyebrow="Response rate"
          value={kpis.response_rate === null ? "—" : kpis.response_rate}
          suffix={kpis.response_rate === null ? undefined : "%"}
          caption={kpis.outreach_empty ? "ready to track" : `${kpis.replies} of ${kpis.outreach_volume} sent`}
        />
        <MetricCard
          eyebrow="Meetings booked"
          value={kpis.meetings_booked.toLocaleString()}
          caption={approx}
          href="/leads?stage=meeting_booked"
        />
        <MetricCard
          eyebrow="Deals closed"
          value={kpis.deals_closed.toLocaleString()}
          caption={approx}
          href="/leads?stage=closed_won"
        />
      </div>
    </section>
  );
}
