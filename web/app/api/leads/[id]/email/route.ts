/**
 * api/leads/[id]/email/route.ts — Send the outreach email for a lead (EMAIL channel).
 *
 * POST → runs stage-5-email for the lead. Used by the operator "Send email" action on has-website
 * leads. $0 until a mailbox is connected (soft no-op). Returns { sent, skipped?, noop? }.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { run as runEmailStage, type EmailLead } from "@/lib/pipeline/stage-5-email";

export const dynamic = "force-dynamic";

export const POST = withApi(async (_req, ctx) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const id = ctx?.params?.id;
  if (!id) return fail("Missing lead id", 400);

  const { data: lead, error } = await getDb()
    .from("leads")
    .select("id,business_name,email,demo_url,primary_offer,lifecycle_stage,phone")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message, 502);
  if (!lead) return fail("Lead not found", 404);

  const result = await runEmailStage(lead as EmailLead);
  return ok(result);
});
