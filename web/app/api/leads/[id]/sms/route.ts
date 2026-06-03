/**
 * api/leads/[id]/sms/route.ts — Text a lead the one-time form link (SMS / DM channel).
 *
 * POST → runs stage-6-sms directly (NOT gated on a call). Used by the operator "Send SMS" action on
 * no-website leads. Issues a one-time link + sends it (Mobivate; soft no-op at $0 until a key is set).
 * Returns { sent, skipped?, noop?, link? }.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { run as runSmsStage, type SmsLead } from "@/lib/pipeline/stage-6-sms";

export const dynamic = "force-dynamic";

export const POST = withApi(async (_req, ctx) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const id = ctx?.params?.id;
  if (!id) return fail("Missing lead id", 400);

  const { data: lead, error } = await getDb()
    .from("leads")
    .select("id,business_name,phone,lifecycle_stage")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message, 502);
  if (!lead) return fail("Lead not found", 404);

  const result = await runSmsStage(lead as SmsLead);
  return ok(result);
});
