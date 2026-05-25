/**
 * StatusChip.tsx — color-coded chip for `batch.status` (queued/running/done/failed).
 *
 * Uses the design-system stage tones. `running` gets the live-pulse dot —
 * the same animation reserved for in-flight signals across the dashboard.
 */

const STATUS_STYLES: Record<
  string,
  { dot: string; text: string; label: string; pulse?: boolean }
> = {
  queued:  { dot: "bg-ink-subtle",  text: "text-ink-muted", label: "Queued" },
  running: { dot: "bg-urgent",      text: "text-urgent",    label: "Running", pulse: true },
  done:    { dot: "bg-positive",    text: "text-positive",  label: "Done" },
  failed:  { dot: "bg-urgent",      text: "text-urgent",    label: "Failed" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.queued;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] font-mono ${s.text}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? "live-dot" : ""}`}
      />
      {s.label}
    </span>
  );
}
