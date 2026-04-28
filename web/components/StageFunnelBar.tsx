/**
 * StageFunnelBar.tsx — compact horizontal bar version of StageFunnel for table rows.
 * Used in the Batches list to show each row's progress at a glance.
 */

const SEGMENTS = ["scraped", "enriched", "generated", "deployed", "outreached"] as const;

export function StageFunnelBar({
  counts,
  total,
}: {
  counts: Record<string, number>;
  total?: number;
}) {
  const totalLeads = total ?? counts.scraped ?? 0;
  if (totalLeads === 0) {
    return (
      <div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full" />
        <div className="flex justify-between mt-1 font-mono text-[10px] text-slate-400">
          <span>Pending</span>
          <span>0%</span>
        </div>
      </div>
    );
  }
  const pct = Math.round((Math.max(...SEGMENTS.map((s) => counts[s] ?? 0)) / totalLeads) * 100);
  return (
    <div>
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
        {SEGMENTS.map((s, i) => {
          const n = counts[s] ?? 0;
          if (n === 0) return null;
          const widthPct = (n / totalLeads) * 100;
          const opacity = 1 - i * 0.12;
          return (
            <div
              key={s}
              className="h-full bg-brand"
              style={{ width: `${widthPct}%`, opacity }}
              title={`${s}: ${n}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1 font-mono text-[10px] text-slate-400">
        <span>{totalLeads} leads</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}
