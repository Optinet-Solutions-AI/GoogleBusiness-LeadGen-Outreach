/**
 * outreach/when-text.ts — plain-English "when does this go out" lines for the email and call previews. Pure.
 *
 * Inputs:  a send/call window (tz + ISO weekdays + start/end hour), instants
 * Outputs: "Mon–Fri, 9:00–20:00 (America/Chicago)", "Mon 13 Nov, 9:10 their time"
 * Used by: lib/email/load-email-preview.ts, lib/calls/load-call-preview.ts
 */
import type { SendWindow } from "../campaigns/send-window";

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** ISO weekdays → "Mon–Fri", "every day", "Mon, Wed, Fri". */
export function daysText(days: number[]): string {
  const d = [...new Set(days)].filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
  if (d.length === 0) return "no days";
  if (d.length === 7) return "every day";
  const contiguous = d.every((n, i) => i === 0 || n === d[i - 1] + 1);
  if (contiguous && d.length >= 3) return `${DAY[d[0]]}–${DAY[d[d.length - 1]]}`;
  return d.map((n) => DAY[n]).join(", ");
}

function hourText(h: number): string {
  return `${Math.max(0, Math.min(24, h))}:00`;
}

/** "Mon–Fri, 9:00–20:00 (America/Chicago)". */
export function windowText(w: SendWindow): string {
  return `${daysText(w.days)}, ${hourText(w.startHour)}–${hourText(w.endHour)} (${w.tz})`;
}

/** An instant as the lead's wall clock: "Mon 13 Nov, 9:10". */
export function localTimeText(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${Number(get("hour")) % 24}:${get("minute")}`;
}
