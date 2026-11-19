/**
 * api/calls/route.ts — Call logs: our AI calls, newest first, with filters.
 *
 * Inputs:  GET ?agent=&result=&from=&to=&test=1&page=
 * Outputs: { success, data: { rows, total, agents, pageSize } }
 * Used by: components/calls/CallLogsClient.tsx (Outreach → Call logs)
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { listCallLogs, PAGE_SIZE, parseCallLogFilters } from "@/lib/calls/call-logs";
import { fail, ok } from "@/lib/response";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  try {
    const data = await listCallLogs(parseCallLogFilters(new URL(req.url).searchParams));
    return ok({ ...data, pageSize: PAGE_SIZE });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 503);
  }
});
