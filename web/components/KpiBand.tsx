/**
 * KpiBand.tsx — the "Key Performance Indicators" band on the Analytics page.
 *
 * Inputs:  Kpis (from lib/kpis-load.loadKpis) — carries the active range/key
 * Outputs: a range toggle (week / month / all + custom From→To) + 7 KPI cards
 * Used by: app/(dashboard)/analytics/page.tsx
 *
 * Display-only, zero client JS. Presets are <Link>s that set ?range=…; the
 * custom range is a GET <form> that sets ?from=…&to=… — the server re-renders.
 */

import Link from "next/link";
import { MetricCard } from "./MetricCard";
import type { Kpis } from "@/lib/kpis";

const PRESETS: { key: "week" | "month" | "all"; label: string; href: string }[] = [
  { key: "week", label: "This week", href: "/analytics?range=week" },
  { key: "month", label: "This month", href: "/analytics?range=month" },
  { key: "all", label: "All time", href: "/analytics" },
];

const pillCls = (active: boolean) =>
  [
    "px-3 py-1.5 rounded text-[11px] uppercase tracking-[0.14em] font-semibold font-mono transition-colors border whitespace-nowrap",
    active
      ? "bg-action text-white border-action"
      : "bg-surface text-ink-muted border-rule hover:bg-surface-alt hover:text-ink",
  ].join(" ");

const dateCls =
  "rounded-md border border-rule bg-surface px-2 py-1 text-[12px] text-ink mono-num focus:border-action";

export function KpiBand({ kpis }: { kpis: Kpis }) {
  const pctOfLeads = (n: number) =>
    kpis.leads_generated > 0 ? `${Math.round((n / kpis.leads_generated) * 100)}% of leads` : undefined;
  // Outcome KPIs are exact all-time; bounded ranges lean on updated_at (a proxy).
  const approx = kpis.key === "all" ? undefined : "approx · by last update";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">Key performance indicators</p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            {PRESETS.map((r) => (
              <Link key={r.key} href={r.href} className={pillCls(kpis.key === r.key)}>
                {r.label}
              </Link>
            ))}
          </div>

          {/* Custom range — pure GET form, no client JS. */}
          <form method="get" action="/analytics" className="flex items-center gap-1.5">
            <input type="date" name="from" defaultValue={kpis.from ?? ""} aria-label="From date" className={dateCls} />
            <span className="text-ink-subtle text-[12px]">→</span>
            <input type="date" name="to" defaultValue={kpis.to ?? ""} aria-label="To date" className={dateCls} />
            <button type="submit" className={pillCls(kpis.key === "custom")}>
              Apply
            </button>
          </form>
        </div>
      </div>

      {kpis.key === "custom" && (
        <p className="text-[11.5px] text-ink-muted">Showing custom range · {kpis.label}</p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mt-1">
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
