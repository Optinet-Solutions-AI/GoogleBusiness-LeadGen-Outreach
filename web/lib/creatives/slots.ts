/**
 * slots.ts — deterministic weekday slot dates for a month plan, and product round-robin assignment.
 *
 * Inputs:  "YYYY-MM" month, posts per week, count, product ids
 * Outputs: ISO date strings (sorted) and product-id assignments
 * Used by: plan generation (concept scheduling)
 */

const DAY_MS = 86_400_000;
// Preferred weekdays (1=Mon..5=Fri) per cadence, chosen so posts are never on adjacent days where possible.
const WEEK_PATTERNS: Record<number, number[]> = {
  1: [3],
  2: [2, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
};

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const weekday = (d: string): number => new Date(`${d}T00:00:00Z`).getUTCDay();

/** Every calendar day of the month as ISO dates. */
export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => iso(Date.UTC(y, m - 1, i + 1)));
}

/** Pick `count` weekdays spread evenly across the month; never two on one day. */
export function spreadSlots(month: string, postsPerWeek: number, count: number): string[] {
  const weekdays = monthDates(month).filter((d) => {
    const w = weekday(d);
    return w >= 1 && w <= 5;
  });
  const n = Math.min(Math.max(0, Math.floor(count)), weekdays.length);
  if (n === 0) return [];
  const pattern = WEEK_PATTERNS[Math.min(5, Math.max(1, Math.round(postsPerWeek)))];
  const preferred = weekdays.filter((d) => pattern.includes(weekday(d)));
  const rest = weekdays.filter((d) => !preferred.includes(d));
  const pool = (preferred.length >= n ? preferred : [...preferred, ...rest.slice(0, n - preferred.length)]).sort();
  return Array.from({ length: n }, (_, i) => pool[Math.floor((i * pool.length) / n)]);
}

/** Round-robin products over date-ordered slots, skipping any used in the previous 7 days; null if all blocked. */
export function assignProducts(slots: string[], productIds: string[]): (string | null)[] {
  const last = new Map<string, number>();
  let cursor = 0;
  return slots.map((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    for (let k = 0; k < productIds.length; k++) {
      const idx = (cursor + k) % productIds.length;
      const id = productIds[idx];
      const prev = last.get(id);
      if (prev === undefined || (t - prev) / DAY_MS >= 7) {
        last.set(id, t);
        cursor = idx + 1;
        return id;
      }
    }
    return null;
  });
}
