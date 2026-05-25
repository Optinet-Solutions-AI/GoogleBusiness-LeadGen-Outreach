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
      ? "text-positive font-bold"
      : hintTone === "warning"
        ? "text-warning font-bold"
        : "text-ink-subtle";
  return (
    <div className="bg-white border border-rule p-4 rounded-lg flex flex-col justify-between h-28">
      <span className="text-label-caps text-ink-subtle uppercase">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold font-mono ${emphasis ? "text-action" : "text-ink"}`}>
          {value}
        </span>
        {hint && <span className={`text-[11px] ${hintColor}`}>{hint}</span>}
      </div>
    </div>
  );
}
