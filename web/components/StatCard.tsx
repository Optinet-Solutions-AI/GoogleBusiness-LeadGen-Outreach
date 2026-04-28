/**
 * StatCard.tsx — number + label tile used at the top of the Batch detail page.
 */

export function StatCard({
  label,
  value,
  hint,
  hintTone = "neutral",
  emphasis = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  hintTone?: "neutral" | "positive" | "warning";
  emphasis?: boolean;
}) {
  const hintColor =
    hintTone === "positive"
      ? "text-emerald-600 font-bold"
      : hintTone === "warning"
        ? "text-amber-600 font-bold"
        : "text-slate-400";
  return (
    <div className="bg-white border border-slate-200 p-4 rounded-lg flex flex-col justify-between h-28">
      <span className="text-label-caps text-slate-400 uppercase">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold font-mono ${emphasis ? "text-brand" : "text-slate-900"}`}>
          {value}
        </span>
        {hint && <span className={`text-[11px] ${hintColor}`}>{hint}</span>}
      </div>
    </div>
  );
}
