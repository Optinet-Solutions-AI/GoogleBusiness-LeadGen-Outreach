/**
 * api/inbox/unread-count/route.ts — count of unread, active inbox threads.
 *
 * Inputs:  none
 * Outputs: { count } — leads in the inbox (replied / open / needs_reply) that are
 *          unread (inbox_read_at is null) and not archived / DNC.
 * Used by: the SideNav inbox badge (polled client-side).
 */

import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  if (!isDbConfigured()) return ok({ count: 0 });
  const { count, error } = await getDb()
    .from("leads")
    .select("id", { count: "exact", head: true })
    .is("inbox_read_at", null)
    .or("stage.eq.replied,inbox_status.in.(open,needs_reply)")
    .not("lifecycle_stage", "in", "(dnc,unsubscribed)");
  if (error) return fail(error.message, 502);
  return ok({ count: count ?? 0 });
});
