/**
 * (dashboard)/analytics/page.tsx — Campaign analytics + monitoring.
 *
 * Inputs:  lib/analytics.loadAnalytics() (all-time, qualified leads)
 * Outputs: a hierarchy that answers "what do I look at first?" — a headline hero
 *          (the few numbers that matter + the go/stop number), then the funnel,
 *          then conversion rates, health, and details.
 * Used by: route "/analytics"
 *
 * Works today on SMS/email data. Form/link steps populate as the connected
 * journey + live provider land; those are labelled "activates with SMS"
 * so empty values read as not-yet-on rather than as failures.
 */

import Link from "next/link";
import { isDbConfigured } from "@/lib/safe-db";
import { loadAnalytics } from "@/lib/analytics";
import { FunnelChart, type FunnelStage } from "@/components/FunnelChart";
import { StatCard } from "@/components/StatCard";
import { KpiBand } from "@/components/KpiBand";
import { loadKpis } from "@/lib/kpis-load";

export const dynamic = "force-dynamic";

// Funnel steps drawn in the chart (leads → texted → clicked → finished).
const CHART_KEYS: { key: string; href: string }[] = [
  { key: "leads",    href: "/leads" },
  { key: "texted",   href: "/inbox" },
  { key: "clicked",  href: "/inbox" },
  { key: "finished", href: "/inbox" },
];

function pct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string };
}) {
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

  const [a, kpis] = await Promise.all([
    loadAnalytics(),
    loadKpis({ range: searchParams.range, from: searchParams.from, to: searchParams.to }),
  ]);
  const byKey = new Map(a.funnel.map((s) => [s.key, s]));
  const n = (key: string) => byKey.get(key)?.count ?? 0;

  const chartStages: FunnelStage[] = CHART_KEYS.map(({ key, href }) => {
    const step = byKey.get(key) ?? { key, label: key, count: 0 };
    return { key, label: step.label, count: step.count, href };
  });

  const costPerFinished =
    a.cost.cost_per_finished_usd === null ? "—" : `$${a.cost.cost_per_finished_usd.toFixed(2)}`;

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow mb-2">Outreach</p>
        <h1 className="editorial-head text-ink text-[32px] md:text-[36px] leading-none">
          Campaign analytics
        </h1>
        <p className="text-[13px] text-ink-muted mt-2">
          Start with the headline, then read the funnel top-to-bottom. Per-campaign numbers live on
          each <Link href="/campaigns" className="text-action hover:underline">campaign</Link>.
        </p>
      </header>

      <KpiBand kpis={kpis} />

      {/* ── 1. START HERE — the headline ───────────────────────────── */}
      <section className="bg-surface border border-rule rounded-lg p-6">
        <p className="eyebrow mb-4">Start here · how is outreach doing?</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          <Hero label="Texted" value={n("texted")} />
          <Hero label="Finished leads" value={n("finished")} sub="form submitted" tone="positive" emphasis />
          <Hero
            label="Cost / finished"
            value={costPerFinished}
            sub="← the go / stop number"
            tone="action"
            emphasis
          />
        </div>
        <p className="text-[12px] text-ink-muted mt-4 leading-relaxed">
          {a.is_empty ? (
            <>
              No messages sent yet — every text, link click and form submission is tracked the moment
              you start sending from a{" "}
              <Link href="/campaigns" className="text-action hover:underline">campaign</Link>.
              The first number to watch is{" "}
              <span className="font-semibold text-ink">Finished</span> (and its rate); the one that
              decides go/stop is <span className="font-semibold text-ink">Cost / finished</span>{" "}
              (activates with live SMS).
            </>
          ) : (
            <>
              Read these three first: how many you <span className="font-semibold text-ink">texted</span>,
              how many <span className="font-semibold text-ink">finished</span> the form, and what each
              finished lead <span className="font-semibold text-ink">cost</span>. The two highlighted
              decide if it&apos;s working.
            </>
          )}
        </p>
      </section>

      {/* ── 2. THE FUNNEL — where do leads drop off? ───────────────── */}
      <section>
        <p className="eyebrow mb-3">Where do leads drop off?</p>
        <FunnelChart
          stages={chartStages}
          title="Conversion funnel · all time"
          caption={`${n("leads").toLocaleString()} qualified leads`}
        />
      </section>

      {/* ── 3. IS IT CONVERTING? — the rates ───────────────────────── */}
      <section>
        <p className="eyebrow mb-1">Is it converting?</p>
        <p className="text-[12px] text-ink-muted mb-3">The % that survives each step. Higher is better.</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Link click rate" value={pct(a.rates.link_click)} hint="texted → clicked" emphasis hintTone="positive" />
          <StatCard label="Form rate" value={pct(a.rates.form)} hint="clicked → finished" />
          <StatCard label="Overall rate" value={pct(a.rates.overall)} hint="leads → finished" />
        </div>
      </section>

      {/* ── 4. ANYTHING NEED ATTENTION? — health ───────────────────── */}
      <section>
        <p className="eyebrow mb-3">Anything need attention?</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Suppressed" value={a.monitoring.suppressed} hint="DNC / opted-out" hintTone={a.monitoring.suppressed > 0 ? "warning" : "neutral"} />
        </div>
      </section>

      {/* ── 5. DETAILS — by offer + spend ──────────────────────────── */}
      <section className="space-y-3">
        <p className="eyebrow">Details</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-surface border border-rule rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-rule">
              <h2 className="eyebrow">Conversion by offer</h2>
            </div>
            <table className="w-full text-left">
              <thead className="bg-surface-alt border-b border-rule">
                <tr>
                  <Th>Offer</Th>
                  <Th className="text-right">Finished</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {a.by_offer.map((o) => (
                  <tr key={o.offer} className="hover:bg-surface-alt transition-colors">
                    <td className="px-4 py-2.5 text-[13px] font-medium text-ink">{o.label}</td>
                    <td className="px-4 py-2.5 mono-num text-[13px] text-positive text-right font-semibold">{o.finished}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Estimated spend" value={`$${a.cost.estimated_usd.toFixed(2)}`} hint="from batch estimates" />
          <StatCard
            label="Actual spend"
            value={a.cost.actual_usd === null ? "—" : `$${a.cost.actual_usd.toFixed(2)}`}
            hint={a.cost.actual_usd === null ? "activates with live SMS" : "SMS + email"}
          />
        </div>
      </section>
    </div>
  );
}

function Hero({
  label,
  value,
  sub,
  tone = "neutral",
  emphasis = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "neutral" | "positive" | "action";
  emphasis?: boolean;
}) {
  const valueColor =
    tone === "positive" ? "text-positive" : tone === "action" ? "text-action" : "text-ink";
  return (
    <div className={emphasis ? "rounded-lg bg-surface-alt p-4" : "p-4"}>
      <p className="text-label-caps text-ink-subtle uppercase mb-1">{label}</p>
      <p className={`editorial-number text-3xl md:text-4xl tabular-nums leading-none ${valueColor}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-[11.5px] text-ink-muted mt-1.5">{sub}</p>}
    </div>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] ${className}`}>
      {children}
    </th>
  );
}
