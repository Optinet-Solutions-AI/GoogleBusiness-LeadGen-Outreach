/**
 * automation/rules.ts — the rules of the automation (operator decisions, 24 Nov 2026). Pure.
 *
 * Inputs:  batch / lead / schedule rows, the time
 * Outputs: the operator's numbers + autoEmailStartAt / autoEmailDue · formLeadOk / formsRoom · nyClock / scheduleDue /
 *          pickSchedule / withinCap / monthStartUtc
 * Used by: lib/automation/{auto-email,auto-contact-forms,schedules}.ts, the batch page, the Batches page
 *
 * 1) A batch made with "Email this batch automatically" starts its batch email 24 h after it finishes (cancellable).
 * 2) Running batch emails send the offer through the contact form of leads with no email: 10 a day in all, 2 per run
 *    of the tick, each lead tried once, never a CAPTCHA. 3) One scheduled 100-lead batch each weekday from 6:00 New
 *    York time, the next active row of the list, within $40 of estimated cost a calendar month.
 */
import { isNoCallCountry } from "@/lib/leads/contact-readiness";
import { leadHost } from "@/lib/contact-form/rules";

export const AUTO_EMAIL_DELAY_HOURS = 24;
export const FORMS_PER_DAY = 10;
/** Contact forms per run of the tick (each takes a minute or two; the tick runs every 15 minutes). */
export const FORMS_PER_TICK = 2;
export const SCHEDULED_BATCH_LIMIT = 100;
export const MONTHLY_CAP_USD = 40;
/** Scheduled batches start from this hour, New York time, Mon–Fri. */
export const SCHEDULE_FROM_HOUR_NY = 6;

export type AutoEmailState = "waiting" | "cancelled" | "started" | "skipped";

export function autoEmailStartAt(finishedAt: Date): string {
  return new Date(finishedAt.getTime() + AUTO_EMAIL_DELAY_HOURS * 3_600_000).toISOString();
}

export function autoEmailDue(b: { auto_email_state: string | null; auto_email_at: string | null }, now: number): boolean {
  return b.auto_email_state === "waiting" && !!b.auto_email_at && Date.parse(b.auto_email_at) <= now;
}

const PAST_FIRST_CONTACT = new Set(["outreached", "replied", "meeting_booked", "meeting_done", "improved", "handed_over", "closed_won", "closed_lost", "dead"]);

/** May this batch lead get the offer through its contact form? (It has no email; the rest get the email.) */
export function formLeadOk(
  l: {
    email: string | null;
    qualified: boolean | null;
    lifecycle_stage: string | null;
    stage: string | null;
    country_code: string | null;
    website_url: string | null;
    contact_page_url: string | null;
  },
  o: { emailed: boolean; triedForm: boolean; includeEu: boolean },
): boolean {
  if (l.email) return false;
  if (l.qualified === false) return false;
  if (l.lifecycle_stage === "unsubscribed" || l.lifecycle_stage === "dnc") return false;
  if (l.stage && PAST_FIRST_CONTACT.has(l.stage)) return false;
  if (o.emailed || o.triedForm) return false;
  if (!o.includeEu && isNoCallCountry((l.country_code ?? "").toLowerCase())) return false;
  return leadHost({ website_url: l.website_url, contact_page_url: l.contact_page_url }) !== null;
}

/** Contact forms this run may send: what's left of today's 10, at most FORMS_PER_TICK. */
export function formsRoom(sentLast24h: number): number {
  return Math.max(0, Math.min(FORMS_PER_TICK, FORMS_PER_DAY - sentLast24h));
}

/** Weekday (1 = Mon … 7 = Sun), hour and date in New York. */
export function nyClock(now: number): { weekday: number; hour: number; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { weekday, hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** A scheduled batch is due on a weekday from 6:00 New York time, unless one already ran today. */
export function scheduleDue(now: number, ranToday: boolean): boolean {
  const c = nyClock(now);
  return !ranToday && c.weekday >= 1 && c.weekday <= 5 && c.hour >= SCHEDULE_FROM_HOUR_NY;
}

/** The next row to run: active, never run first, then the one run longest ago (ties: oldest added). */
export function pickSchedule<T extends { active: boolean; last_run_at: string | null; created_at: string }>(rows: T[]): T | null {
  const active = rows.filter((r) => r.active);
  if (!active.length) return null;
  return [...active].sort((a, b) => {
    if (!a.last_run_at !== !b.last_run_at) return a.last_run_at ? 1 : -1;
    const byRun = (a.last_run_at ?? "").localeCompare(b.last_run_at ?? "");
    return byRun || a.created_at.localeCompare(b.created_at);
  })[0];
}

export function withinCap(spentThisMonth: number, nextEstimate: number): boolean {
  return spentThisMonth + nextEstimate <= MONTHLY_CAP_USD;
}

export function monthStartUtc(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
