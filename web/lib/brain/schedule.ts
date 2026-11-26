/**
 * brain/schedule.ts — when each approved lead gets its first touch and its call (26 Nov 2026). Pure.
 *
 * Inputs:  the approved rows (lead + channels), the first-email times the email campaign gave (lead → ISO), the
 *          sending window (Mon–Fri 9–17 in the batch's time), the job's contact forms per day, now
 * Outputs: lead → { first_touch_at, call_due_at }
 * Used by: lib/brain/approve.ts
 *
 * A lead with an email takes its email's send time. A lead with no email (contact form or call only) is spread over
 * the same window so that no day gets more than the job's forms-per-day: 100 of them never fall due on one day.
 * The call is due CALL_DELAY_DAYS (2) days after the first touch.
 */
import { staggerSends, type SendWindow } from "@/lib/campaigns/send-window";
import { CALL_DELAY_DAYS, type Channel } from "./rules";

export function scheduleTouches(o: {
  rows: { lead_id: string; channels: Channel[] }[];
  emailSlots: Record<string, string>;
  window: SendWindow;
  formsPerDay: number;
  now: Date;
}): Record<string, { first_touch_at: string; call_due_at: string | null }> {
  const perDay = Math.max(1, o.formsPerDay || 10);
  const windowMinutes = Math.max(60, (o.window.endHour - o.window.startHour) * 60);
  // nextSlot adds 4–20 minutes to each slot: with this gap the spacing is at least window / perDay, so a day never
  // takes more than perDay.
  const gapMinutes = Math.max(3, Math.ceil(windowMinutes / perDay) - 4);
  const noEmail = o.rows.filter((r) => !o.emailSlots[r.lead_id]).map((r) => r.lead_id);
  const spread = staggerSends({ ids: noEmail, window: o.window, after: o.now, gapMinutes });
  const out: Record<string, { first_touch_at: string; call_due_at: string | null }> = {};
  for (const r of o.rows) {
    const first = o.emailSlots[r.lead_id] ?? spread[r.lead_id];
    out[r.lead_id] = {
      first_touch_at: first,
      call_due_at: r.channels.includes("call") ? new Date(Date.parse(first) + CALL_DELAY_DAYS * 86_400_000).toISOString() : null,
    };
  }
  return out;
}
