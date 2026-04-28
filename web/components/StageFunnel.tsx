/**
 * StageFunnel.tsx — vertical-bar funnel of leads by stage in a batch.
 *
 * Renders 7 segments scaled to the largest count, in pipeline order.
 * Pulled from the Stitch batch_detail screen.
 */

const FUNNEL_ORDER = [
  { key: "scraped",        label: "Scraped" },
  { key: "enriched",       label: "Enriched" },
  { key: "generated",      label: "Gen'd" },
  { key: "deployed",       label: "Deployed" },
  { key: "outreached",     label: "Outreached" },
  { key: "replied",        label: "Replied" },
  { key: "meeting_booked", label: "Booked" },
] as const;

export function StageFunnel({ counts }: { counts: Record<string, number> }) {
  const max = Math.max(1, ...FUNNEL_ORDER.map((s) => counts[s.key] ?? 0));
  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Pipeline funnel</h3>
      </div>
      <div className="p-6">
        <div className="flex items-end h-24 gap-1.5">
          {FUNNEL_ORDER.map((s, i) => {
            const n = counts[s.key] ?? 0;
            const heightPct = (n / max) * 100;
            const isReplied = s.key === "replied";
            const isBooked = s.key === "meeting_booked";
            const opacity = 1 - i * 0.06;
            const bg = isBooked ? "bg-orange-400" : isReplied ? "bg-emerald-500" : "bg-brand";
            return (
              <div key={s.key} className="flex-1 flex flex-col items-center">
                <span className="text-[11px] font-mono mb-2">{n}</span>
                <div
                  className={`w-full ${bg} rounded-t-sm`}
                  style={{
                    height: `${Math.max(heightPct, 3)}%`,
                    opacity: isReplied || isBooked ? 1 : opacity,
                    minHeight: 4,
                  }}
                  title={`${s.label}: ${n}`}
                />
                <span className="text-[10px] mt-2 font-semibold text-slate-400 uppercase">{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
