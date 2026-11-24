/**
 * api/batch-schedules/[id]/route.ts — pause / resume or remove a Daily batches row.
 *
 * Inputs:  PATCH params.id + { active } · DELETE params.id
 * Outputs: { row } · { removed: true }
 * Used by: components/batches/DailyBatches.tsx
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { removeSchedule, ScheduleError, setScheduleActive } from "@/lib/automation/schedules";
import { patchScheduleBody } from "@/lib/automation/request";

export const dynamic = "force-dynamic";

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = patchScheduleBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid body", 422);
  try {
    return ok({ row: await setScheduleActive(params.id, parsed.data.active) });
  } catch (err) {
    if (err instanceof ScheduleError) return fail(err.message, err.status);
    throw err;
  }
});

export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  await removeSchedule(params.id);
  return ok({ removed: true });
});
