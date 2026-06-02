/**
 * (dashboard)/analytics/page.tsx — Voice & SMS campaign analytics + monitoring.
 *
 * Inputs:  lib/analytics.loadAnalytics() (all-time, qualified leads)
 * Outputs: the "don't run blind" view — conversion funnel, step rates, call-outcome
 *          breakdown, operational monitoring, cost, and per-offer conversion.
 * Used by: route "/analytics"
 *
 * Works today on manual-call data (call_attempts + outreach_events). The SMS / link / form
 * steps and actual cost populate automatically as the connected journey + live provider land.
 */

import Link from "next/link";
import { isDbConfigured } from "@/lib/safe-db";
import { loadAnalytics, type CampaignAnalytics } from "@/lib/analytics";
import { FunnelChart, type FunnelStage } from "@/components/FunnelChart";
import { StatCard } from "@/components/StatCard";

export const dynamic = "force-dynamic";

// Which funnel steps to draw in the 6-column chart (Connected is shown as a KPI instead).
const CHART_KEYS: { key: string; href: string }[] = [
  { key: "leads", href: "/leads" },
  { key: "called", href: "/calls" },
  { key: "interested", href: "/calls" },
  { key: "texted", href: "/replies" },
  { key: "clicked", href: "/replies" },
  { key: "finished", href: "/replies" },
];

function pct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

export default async function AnalyticsPage() {
  if (!isDbConfigured()) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-12 text-center">
        <h1 className="editorial-head text-ink text-xl mb-2">Supabase not configured</h1>
        <p className="text-[13px] text-ink-muted">
          Set SUPABASE_URL + SUPABASE_SERVICE_KEY to load campaign analytics.
        </p>
      </div>
    );
  }

  const a: CampaignAnalytics = await loadAnalytics();

  const byKey = new Map(a.funnel.map((s) => [s.key, s]));
  const chartStages: FunnelStage[] = CHART_KEYS.map(({ key, href }) => {
    const step = byKey.get(key) ?? { key, label: key, count: 0 };
    return { key, label: step.label, count: step.count, href };
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Outreach</p>
          <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">
            Campaign analytics
          </h1>
          <p className="text-[13px] text-ink-muted mt-2">
            All-time voice &amp; SMS conversion. Per-campaign numbers live on each{" "}
            <Link href="/batches" className="text-action hover:underline">batch</Link>.
          </p>
        </div>
      </header>

      {a.is_empty && (
        <div className="rounded bg-action-soft border border-action/30 px-4 py-3 text-[13px] text-action leading-relaxed">
          <p className="font-bold mb-0.5">No calls logged yet — but the instrumentation is live.</p>
          <p className="text-ink-muted">
            Every call, outcome, text, link-click and form submit is tracked from the moment you
            start working the <Link href="/calls" className="text-action hover:underline">call queue</Link>.
            These numbers populate as you go — so the first real campaign is measured, not blind.
          </p>
        </div>
      )}

      {/* Conversion funnel */}
      <FunnelChart stages={chartStages} title="Conversion funnel · all time" caption={`${byKey.get("leads")!.count.toLocaleString()} qualified leads`} />

      {/* Step conversion rates */}
      <section>
        <p className="eyebrow mb-3">Step conversion</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Contact rate" value={pct(a.rates.contact)} hint="called → connected" />
          <StatCard label="Interest rate" value={pct(a.rates.interest)} hint="connected → interested" emphasis />
          <StatCard label="Link click rate" value={pct(a.rates.link_click)} hint="texted → clicked" />
          <StatCard label="Form rate" value={pct(a.rates.form)} hint="clicked → finished" />
          <StatCard label="Overall" value={pct(a.rates.overall)} hint="lead → finished" emphasis hintTone="positive" />
        </div>
      </section>

      {/* Cost */}
      <section>
        <p className="eyebrow mb-3">Cost &amp; unit economics</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Estimated spend" value={`$${a.cost.estimated_usd.toFixed(2)}`} hint="from batch estimates" />
          <StatCard
            label="Actual spend"
            value={a.cost.actual_usd === null ? "—" : `$${a.cost.actual_usd.toFixed(2)}`}
            hint={a.cost.actual_usd === null ? "activates with live voice" : "calls + SMS"}
          />
          <StatCard
            label="Cost / finished lead"
            value={a.cost.cost_per_finished_usd === null ? "—" : `$${a.cost.cost_per_finished_usd.toFixed(2)}`}
            hint="the go / stop number"
            emphasis
          />
        </div>
      </section>

      {/* Monitoring */}
      <section>
        <p className="eyebrow mb-3">Monitoring &amp; health</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="In-flight" value={a.monitoring.open} hint="queued + dialing" />
          <StatCard label="Failed" value={a.monitoring.failed} hint="couldn't connect" hintTone={a.monitoring.failed > 0 ? "warning" : "neutral"} />
          <StatCard label="No answer" value={a.monitoring.no_answer} />
          <StatCard label="Voicemail" value={a.monitoring.voicemail} />
          <StatCard label="Suppressed" value={a.monitoring.suppressed} hint="DNC / opted-out" hintTone={a.monitoring.suppressed > 0 ? "warning" : "neutral"} />
        </div>
      </section>

      {/* Outcome breakdown + by offer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Breakdown
          title={`Call outcomes (${a.outcomes.total_attempts} attempts)`}
          rows={a.outcomes.by_outcome}
          emptyHint="No dispositions logged yet."
        />
        <section className="bg-surface border border-rule rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-rule">
            <h2 className="eyebrow">Conversion by offer</h2>
          </div>
          <table className="w-full text-left">
            <thead className="bg-surface-alt border-b border-rule">
              <tr>
                <Th>Offer</Th>
                <Th className="text-right">Called</Th>
                <Th className="text-right">Interested</Th>
                <Th className="text-right">Finished</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {a.by_offer.map((o) => (
                <tr key={o.offer} className="hover:bg-surface-alt transition-colors">
                  <td className="px-4 py-2.5 text-[13px] font-medium text-ink">{o.label}</td>
                  <td className="px-4 py-2.5 mono-num text-[13px] text-ink-muted text-right">{o.called}</td>
                  <td className="px-4 py-2.5 mono-num text-[13px] text-ink text-right">{o.interested}</td>
                  <td className="px-4 py-2.5 mono-num text-[13px] text-positive text-right font-semibold">{o.finished}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Breakdown({ title, rows, emptyHint }: { title: string; rows: Record<string, number>; emptyHint: string }) {
  const entries = Object.entries(rows).sort(([, a], [, b]) => b - a);
  return (
    <section className="bg-surface border border-rule rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-rule">
        <h2 className="eyebrow">{title}</h2>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-ink-muted">{emptyHint}</p>
      ) : (
        <ul className="divide-y divide-rule">
          {entries.map(([key, count]) => (
            <li key={key} className="px-4 py-2.5 flex items-center justify-between">
              <span className="text-[13px] text-ink capitalize">{key.replaceAll("_", " ")}</span>
              <span className="mono-num text-[13px] font-semibold text-ink">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}>
      {children}
    </th>
  );
}
