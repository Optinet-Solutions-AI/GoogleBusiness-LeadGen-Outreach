/**
 * api/batch-schedules/route.ts — Daily batches: the list + this month's spend / add a row.
 *
 * Inputs:  GET · POST { niche, city, country_code? }
 * Outputs: { rows, missing, spent, cap, perBatch, limit, next } · { row } · 503 + a plain sentence without migration 068
 * Used by: components/batches/DailyBatches.tsx
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { addSchedule, scheduleOverview, ScheduleError } from "@/lib/automation/schedules";
import { addScheduleBody } from "@/lib/automation/request";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  return ok(await scheduleOverview());
});

export const POST = withApi(async (req: Request) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = addScheduleBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 422);
  try {
    return ok({ row: await addSchedule(parsed.data) });
  } catch (err) {
    if (err instanceof ScheduleError) return fail(err.message, err.status);
    throw err;
  }
});
