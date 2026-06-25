/**
 * send-window.ts — Next allowed send time inside a campaign's day/hour window,
 *                  in the prospect's timezone, with deterministic jitter. Pure.
 *
 * Inputs:  an "after" instant, a window (tz + ISO days + start/end hour), a seed
 * Outputs: the next Date >= after that falls on an allowed day inside the hour
 *          window in window.tz, plus a seeded 4-20 min jitter so sends don't
 *          fire on a fixed rhythm
 * Used by: lib/pipeline/sequence-scheduler.ts (scheduling seq_next_step_at)
 *
 * Timezone math uses Intl.DateTimeFormat (no date lib in this repo). Scans
 * forward up to 14 days for an allowed slot; returns `after` only as a last
 * resort. Deterministic: same seed + inputs -> same Date (safe to re-run).
 */

export interface SendWindow {
  tz: string;
  days: number[]; // ISO weekday 1=Mon..7=Sun
  startHour: number;
  endHour: number;
}

const ISO_BY_WEEKDAY: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Wall-clock hour, minute, and ISO weekday of an instant in a timezone. */
function zonedParts(d: Date, tz: string): { hour: number; minute: number; iso: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    iso: ISO_BY_WEEKDAY[get("weekday")],
  };
}

export function nextSlot(opts: {
  after: Date;
  window: SendWindow;
  seed: string;
  jitterMinMin?: number;
  jitterMaxMin?: number;
}): Date {
  const { after, window, seed } = opts;
  const jitMin = opts.jitterMinMin ?? 4;
  const jitMax = opts.jitterMaxMin ?? 20;
  const jitterMs = (jitMin + (hash(seed) % Math.max(1, jitMax - jitMin + 1))) * 60_000;

  // Step in 5-minute increments from `after`, up to 14 days, to find the first
  // instant that is on an allowed day and within [startHour, endHour) in tz.
  const STEP_MS = 5 * 60_000;
  const MAX_MS = 14 * 24 * 60 * 60_000;
  for (let t = 0; t <= MAX_MS; t += STEP_MS) {
    const cand = new Date(after.getTime() + t);
    const { hour, iso } = zonedParts(cand, window.tz);
    if (window.days.includes(iso) && hour >= window.startHour && hour < window.endHour) {
      const withJitter = new Date(cand.getTime() + jitterMs);
      // Re-verify the jittered time is still inside the window; if jitter pushed
      // it past endHour, drop the jitter (stay inside the window).
      const j = zonedParts(withJitter, window.tz);
      if (window.days.includes(j.iso) && j.hour >= window.startHour && j.hour < window.endHour) {
        return withJitter;
      }
      return cand;
    }
  }
  return after; // last resort — no valid slot found in 14 days
}
