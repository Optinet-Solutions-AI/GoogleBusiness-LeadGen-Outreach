/**
 * call-hours.ts — Per-campaign calling-window logic. Pure, no I/O.
 *
 * Inputs:  a campaign schedule (days + hour window + timezone) and the current time
 * Outputs: campaignTimezone() maps a country to a representative IANA tz;
 *          callableNow() says whether a lead is callable right now (+ why not)
 * Used by: lib/analytics + the /campaigns queue ordering (Chunk 2b); the live-dial
 *          gate later (integration plan). `now` is injected so it's unit-testable.
 *
 * Representative-tz-per-country is an approximation (large countries span zones) —
 * fine for the single-country pilot. Unknown tz → NOT callable (never dial when we
 * can't prove we're in-hours).
 */

/** Lowercase ISO-3166 alpha-2 → representative IANA timezone. Extend as needed. */
const COUNTRY_TZ: Record<string, string> = {
  us: "America/New_York",
  ca: "America/Toronto",
  gb: "Europe/London",
  ie: "Europe/Dublin",
  au: "Australia/Sydney",
  nz: "Pacific/Auckland",
  ph: "Asia/Manila",
};

export function campaignTimezone(countryCode: string | null | undefined): string {
  if (!countryCode) return "UTC";
  return COUNTRY_TZ[countryCode.trim().toLowerCase()] ?? "UTC";
}

export interface CallWindow {
  call_days: number[]; // 1=Mon..7=Sun
  call_start_hour: number; // 0-23
  call_end_hour: number; // 0-23, exclusive upper bound
  timezone: string; // IANA; "" / invalid → not callable
}

export type NotCallableReason = "unknown_tz" | "outside_days" | "outside_hours";

export interface CallableResult {
  callable: boolean;
  reason?: NotCallableReason;
}

/** Local weekday (1=Mon..7=Sun) + hour (0-23) for `now` in `tz`, or null if tz invalid. */
function localParts(now: Date, tz: string): { weekday: number; hour: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "";
    const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const weekday = map[wd];
    let hour = parseInt(hourStr, 10);
    if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
    if (!weekday || Number.isNaN(hour)) return null;
    return { weekday, hour };
  } catch {
    return null;
  }
}

export function callableNow(win: CallWindow, now: Date): CallableResult {
  if (!win.timezone) return { callable: false, reason: "unknown_tz" };
  const parts = localParts(now, win.timezone);
  if (!parts) return { callable: false, reason: "unknown_tz" };
  if (!win.call_days.includes(parts.weekday)) return { callable: false, reason: "outside_days" };
  if (parts.hour < win.call_start_hour || parts.hour >= win.call_end_hour) {
    return { callable: false, reason: "outside_hours" };
  }
  return { callable: true };
}
