/**
 * period.ts — resolve a calendar period (week/month/year) + offset into a
 * concrete [start, end) UTC window and a human label. Pure → unit-testable.
 *
 * Inputs:  a PeriodKind, an integer offset (0 = current, -1 = previous), `now`.
 * Outputs: ResolvedPeriod { kind, offset, start, end, label, isCurrent }.
 * Used by: app/(dashboard)/status/page.tsx
 */
export type PeriodKind = "week" | "month" | "year";

export interface ResolvedPeriod {
  kind: PeriodKind;
  offset: number;   // 0 = current, negative = past
  start: string;    // ISO, inclusive
  end: string;      // ISO, exclusive
  label: string;
  isCurrent: boolean;
}

export function parsePeriod(v: string | undefined): PeriodKind {
  return v === "month" || v === "year" ? v : "week";
}

/** Clamp to a non-positive integer — future periods are always empty. */
export function parseOffset(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  return i > 0 ? 0 : i;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** ISO-8601 week label for the week containing `monday` (its Monday 00:00 UTC). */
function isoWeekLabel(monday: Date): string {
  const d = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of this ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((+d - +yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function resolvePeriod(kind: PeriodKind, offset: number, now: Date): ResolvedPeriod {
  const off = offset > 0 ? 0 : Math.trunc(offset);
  let start: Date;
  let end: Date;
  let label: string;

  if (kind === "week") {
    const day = now.getUTCDay() || 7; // Mon=1..Sun=7
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
    start = new Date(monday);
    start.setUTCDate(start.getUTCDate() + off * 7);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    label = `Week ${isoWeekLabel(start)}`;
  } else if (kind === "month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + off, 1));
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    label = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear() + off, 0, 1));
    end = new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1));
    label = `${start.getUTCFullYear()}`;
  }

  return { kind, offset: off, start: start.toISOString(), end: end.toISOString(), label, isCurrent: off === 0 };
}
