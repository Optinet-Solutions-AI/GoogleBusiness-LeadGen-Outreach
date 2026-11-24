/**
 * automation/schedules.ts — Daily batches (24 Nov 2026): a list of niche + city; each weekday the next one runs as a
 * 100-lead batch with its email set to start by itself, within $40 of estimated cost a calendar month.
 *
 * Inputs:  the batch_schedules list (migration 068); the time
 * Outputs: listSchedules / addSchedule / setScheduleActive / removeSchedule · scheduleOverview (list + this month's
 *          spend) · runScheduledBatch (creates and runs the day's batch: lib/pipeline/orchestrator createBatch + runBatch)
 * Used by: app/api/batch-schedules/**, lib/automation/tick.ts (Cloud Run MODE=automation)
 *
 * Each scheduled batch: Apify, 100 leads, AI Lookup on, auto email on, batches.schedule_id set. The spend counted is
 * each scheduled batch's estimated search + AI Lookup cost (what runs on its own), this calendar month (UTC).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { env } from "@/lib/config";
import { estimate } from "@/lib/pricing";
import { batchAiCap } from "@/lib/batch-settings";
import { templateForNiche } from "@/lib/data/niches";
import { createBatch, runBatch } from "@/lib/pipeline/orchestrator";
import { MONTHLY_CAP_USD, SCHEDULED_BATCH_LIMIT, monthStartUtc, nyClock, pickSchedule, scheduleDue, withinCap } from "./rules";

const log = getLogger("batch-schedules");

export const MISSING_068 = "Daily batches need database update 068 (run db/migrations/068_automation.sql in Supabase).";

export interface ScheduleRow {
  id: string;
  niche: string;
  city: string;
  country_code: string;
  active: boolean;
  last_run_at: string | null;
  last_batch_id: string | null;
  created_at: string;
}

export class ScheduleError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "ScheduleError";
  }
}

const COLS = "id,niche,city,country_code,active,last_run_at,last_batch_id,created_at";
const missing = (msg: string | undefined) => /batch_schedules|schedule_id/.test(msg ?? "") && /does not exist|could not find|schema cache/i.test(msg ?? "");

export async function listSchedules(): Promise<{ rows: ScheduleRow[]; missing: boolean }> {
  const { data, error } = await getDb().from("batch_schedules").select(COLS).order("created_at", { ascending: true });
  if (error) {
    if (missing(error.message)) return { rows: [], missing: true };
    throw new Error(error.message);
  }
  return { rows: (data ?? []) as ScheduleRow[], missing: false };
}

export async function addSchedule(input: { niche: string; city: string; country_code: string }): Promise<ScheduleRow> {
  const { data, error } = await getDb().from("batch_schedules").insert({ ...input, active: true }).select(COLS).single();
  if (error) throw new ScheduleError(missing(error.message) ? MISSING_068 : error.message, missing(error.message) ? 503 : 500);
  return data as ScheduleRow;
}

export async function setScheduleActive(id: string, active: boolean): Promise<ScheduleRow> {
  const { data, error } = await getDb().from("batch_schedules").update({ active }).eq("id", id).select(COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ScheduleError("Not found", 404);
  return data as ScheduleRow;
}

export async function removeSchedule(id: string): Promise<void> {
  const { error } = await getDb().from("batch_schedules").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** This calendar month's estimated cost of scheduled batches, and whether today's (New York date) already exists. */
async function monthAndToday(now: number): Promise<{ spent: number; ranToday: boolean }> {
  const { data, error } = await getDb()
    .from("batches")
    .select("limit,created_at")
    .not("schedule_id", "is", null)
    // From the start of this month, or 2 days back on the 1st (to see "today" across the month change).
    .gte("created_at", new Date(Math.min(Date.parse(monthStartUtc(now)), now - 2 * 86_400_000)).toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { limit: number | null; created_at: string }[];
  const month = monthStartUtc(now);
  const spent = rows.filter((r) => r.created_at >= month).reduce((a, r) => a + runCost(r.limit ?? SCHEDULED_BATCH_LIMIT), 0);
  const { data: todays, error: tErr } = await getDb().from("batches").select("id").eq("scheduled_for", nyClock(now).date).limit(1);
  if (tErr) throw new Error(tErr.message);
  return { spent, ranToday: (todays ?? []).length > 0 };
}

/**
 * What a scheduled batch spends on its own: the search + AI Lookup (the estimate's scrape part). Building demo
 * websites is never automatic, so the estimate's build part doesn't count toward the monthly cap.
 */
function runCost(limit: number): number {
  return estimate("apify", limit, { aiCap: batchAiCap(env.CONTACT_AI_MAX_PER_BATCH, { ai_lookup: true }), siteCap: env.WEBSITE_AI_MAX_PER_BATCH }).scrape.subtotal_usd;
}
const nextEstimate = () => runCost(SCHEDULED_BATCH_LIMIT);

export async function scheduleOverview(now: number = Date.now()): Promise<{
  rows: ScheduleRow[];
  missing: boolean;
  spent: number;
  cap: number;
  perBatch: number;
  limit: number;
  next: ScheduleRow | null;
}> {
  const { rows, missing: miss } = await listSchedules();
  const { spent } = miss ? { spent: 0 } : await monthAndToday(now).catch(() => ({ spent: 0 }));
  return { rows, missing: miss, spent: Math.round(spent * 100) / 100, cap: MONTHLY_CAP_USD, perBatch: nextEstimate(), limit: SCHEDULED_BATCH_LIMIT, next: pickSchedule(rows) };
}

/** Create and run the day's scheduled batch when it's due (weekday, from 6:00 New York, once a day, within the cap). */
export async function runScheduledBatch(now: number = Date.now()): Promise<{ ran: boolean; note: string; batchId?: string }> {
  const { rows, missing: miss } = await listSchedules();
  if (miss) return { ran: false, note: "migration 068 not applied" };
  const { spent, ranToday } = await monthAndToday(now);
  if (!scheduleDue(now, ranToday)) return { ran: false, note: ranToday ? "already ran today" : "not a weekday morning yet" };
  const row = pickSchedule(rows);
  if (!row) return { ran: false, note: "no active row in Daily batches" };
  const cost = nextEstimate();
  if (!withinCap(spent, cost)) return { ran: false, note: `monthly cap reached ($${spent.toFixed(2)} of $${MONTHLY_CAP_USD})` };

  // One scheduled batch per New York day: the unique scheduled_for column makes a second run (an overlapping tick, a
  // hand-started execution) fail here instead of paying for a second batch.
  let id: string;
  try {
    ({ id } = await createBatch({
      niche: row.niche,
      city: row.city,
      template_slug: templateForNiche(row.niche),
      scraper: "apify",
      limit: SCHEDULED_BATCH_LIMIT,
      country_code: row.country_code,
      settings: { ai_lookup: true, auto_email: true } as Parameters<typeof createBatch>[0]["settings"],
      extra: { schedule_id: row.id, scheduled_for: nyClock(now).date },
    }));
  } catch (err) {
    if (/duplicate key|unique/i.test(String(err))) return { ran: false, note: "today's batch was already created by another run" };
    throw err;
  }
  const db = getDb();
  await db.from("batch_schedules").update({ last_run_at: new Date(now).toISOString(), last_batch_id: id }).eq("id", row.id);
  log.info({ schedule_id: row.id, batch_id: id, niche: row.niche, city: row.city }, "schedule.batch_created");
  await runBatch(id, { runner: "cloud-run" });
  return { ran: true, note: `ran ${row.niche} / ${row.city}`, batchId: id };
}
