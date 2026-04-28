/**
 * StatusChip.tsx — color-coded chip for `batch.status` (queued/running/done/failed).
 */

const STATUS_STYLES: Record<string, { dot: string; text: string; label: string; pulse?: boolean }> = {
  queued:  { dot: "bg-slate-400",  text: "text-slate-500",  label: "Queued" },
  running: { dot: "bg-blue-500",   text: "text-blue-600",   label: "Running", pulse: true },
  done:    { dot: "bg-emerald-500",text: "text-emerald-600",label: "Done" },
  failed:  { dot: "bg-rose-500",   text: "text-rose-600",   label: "Failed" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.queued;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
      {s.label}
    </span>
  );
}
