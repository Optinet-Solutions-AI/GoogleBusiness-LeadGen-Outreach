/**
 * FunnelChart.tsx — horizontal conversion funnel for the home page.
 *
 * Inputs:  ordered stages with counts (e.g. scraped 470 → won 4)
 * Outputs: 6-column funnel where each column is a vertical bar whose height
 *          is proportional to the stage's count vs the FIRST stage. Below each
 *          bar: stage label + count + drop-off %. Bars are clickable filters.
 * Used by: app/(dashboard)/page.tsx (mission control)
 *
 * Aesthetic: bars are stepped ink shades (top dark → middle muted → won ember)
 * so the visual reads as "depth attenuating with each gate". No tooltips —
 * everything important is labeled inline.
 */

import Link from "next/link";

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** Optional override for what filter the bar links to. Defaults to /leads?stage=key. */
  href?: string;
}

interface Props {
  stages: FunnelStage[];
  /** Title above the chart. */
  title?: string;
  /** Caption above the chart on the right. */
  caption?: string;
}

// Monochrome ramp: black at the top of the funnel fading to light gray as
// stages narrow, with black again on the final "won" column to re-emphasise
// the prize. No hue — matches the high-contrast shell.
const BAR_SHADES = [
  "rgb(9 9 11)",        // ink — most leads
  "rgb(52 52 56)",      // zinc-800
  "rgb(90 90 98)",      // zinc-600
  "rgb(133 133 140)",   // zinc-500
  "rgb(176 176 184)",   // zinc-400
  "rgb(9 9 11)",        // finished / won — black (the prize)
];

export function FunnelChart({ stages, title = "Funnel · all time", caption }: Props) {
  if (stages.length === 0) return null;
  const base = stages[0].count || 1;
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <section className="bg-surface border border-rule rounded-lg p-6">
      <header className="flex items-baseline justify-between mb-7">
        <span className="eyebrow">{title}</span>
        {caption && <span className="text-[11.5px] text-ink-muted">{caption}</span>}
      </header>

      <div className="grid grid-cols-6 gap-3 lg:gap-5 items-end" style={{ minHeight: "140px" }}>
        {stages.map((stage, i) => {
          const heightPct = max > 0 ? Math.max(8, (stage.count / max) * 100) : 8;
          const conversionFromPrev =
            i === 0 || stages[i - 1].count === 0
              ? null
              : Math.round((stage.count / stages[i - 1].count) * 100);
          const totalPct = base > 0 ? Math.round((stage.count / base) * 100) : 0;
          const href = stage.href ?? `/leads?stage=${stage.key}`;

          return (
            <Link
              key={stage.key}
              href={href}
              className="group flex flex-col items-stretch text-center"
            >
              {/* Bar zone — fixed height, bar grows from bottom */}
              <div className="relative h-[130px] flex items-end mb-3">
                <div
                  className="funnel-bar w-full rounded-t group-hover:opacity-90 transition-opacity"
                  style={{
                    height: `${heightPct}%`,
                    background: BAR_SHADES[i] ?? BAR_SHADES[BAR_SHADES.length - 1],
                    animationDelay: `${i * 80}ms`,
                  }}
                  aria-hidden
                />
              </div>

              {/* Stage label */}
              <div className="eyebrow text-ink-subtle/80 mb-1.5">{stage.label}</div>

              {/* Count */}
              <div className="editorial-number text-ink text-2xl tabular-nums mb-1">
                {stage.count.toLocaleString()}
              </div>

              {/* Conversion from previous + total */}
              <div className="mono-num text-[10px] text-ink-muted leading-tight">
                {conversionFromPrev !== null && (
                  <span className="font-semibold">{conversionFromPrev}%</span>
                )}
                <span className="text-ink-subtle">
                  {conversionFromPrev !== null ? " · " : ""}
                  {totalPct}% of top
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
