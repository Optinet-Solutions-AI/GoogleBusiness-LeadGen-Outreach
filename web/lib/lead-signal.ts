/**
 * lead-signal.ts — labels + one-line summary for a lead's closure/layoff signal. Pure.
 *
 * Inputs:  { signal_type, signal_date, signal_meta } from a lead row
 * Outputs: signalTypeLabel(), signalSummary() — display strings for the dashboard
 * Used by: components/BatchLeadsTables.tsx, components/LeadsTable.tsx, app/(dashboard)/leads/[id]/page.tsx
 */

export interface SignalFields {
  signal_type?: string | null;
  signal_date?: string | null;
  signal_source_url?: string | null;
  signal_meta?: Record<string, unknown> | null;
}

export const SIGNAL_FIELD_COLS = "signal_type,signal_date,signal_source_url,signal_meta";

export const SIGNAL_FILTER_OPTIONS = [
  { value: "closure", label: "Closure" },
  { value: "layoff", label: "Layoff" },
  { value: "unspecified", label: "Unspecified" },
];

export function signalTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case "closure":
      return "Closure";
    case "layoff":
      return "Layoff";
    case "unspecified":
      return "WARN notice (type not published)";
    case "bankruptcy":
      return "Bankruptcy";
    case "listing":
      return "Listing";
    default:
      return type ?? "";
  }
}

/** Staff count from signal_meta.employees_affected, or null when unknown. */
export function signalStaff(meta: SignalFields["signal_meta"]): number | null {
  const n = Number(meta?.employees_affected);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "Closure · eff. 2026-11-23 · 80 staff" (parts omitted when unknown). */
export function signalSummary(l: SignalFields, effective: "eff." | "effective" = "eff."): string {
  if (!l.signal_type) return "";
  const staff = signalStaff(l.signal_meta);
  return [
    signalTypeLabel(l.signal_type),
    l.signal_date ? `${effective} ${l.signal_date}` : null,
    staff ? `${staff} staff` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
