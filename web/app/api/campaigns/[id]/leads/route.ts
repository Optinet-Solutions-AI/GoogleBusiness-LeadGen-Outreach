/**
 * POST /api/campaigns/[id]/leads — add selected leads to an existing campaign.
 *
 * Inputs:  params.id (campaign UUID), body: { lead_ids: string[] }
 * Outputs: { added, skipped: { not_reachable, suppressed, already_member } }
 * Used by: operator dashboard campaign detail → "Add leads" flow
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { addMembers } from "@/lib/campaigns/add-members";
import type { Channel } from "@/lib/campaigns/eligibility";

export const dynamic = "force-dynamic";

const Body = z.object({ lead_ids: z.array(z.string().uuid()).min(1).max(5000) });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);

  const db = getDb();
  const { data: camp, error } = await db
    .from("call_campaigns")
    .select("id,channel")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return fail(error.message, 502);
  if (!camp) return fail("Campaign not found", 404);
  if (!camp.channel) return fail("Campaign has no channel", 400);

  const result = await addMembers(db, { id: camp.id, channel: camp.channel as Channel }, parsed.data.lead_ids);
  return ok(result);
});
