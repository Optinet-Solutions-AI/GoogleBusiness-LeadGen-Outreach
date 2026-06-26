/**
 * api/campaigns/[id]/route.ts — GET: campaign + membership counts. PATCH: status.
 *
 * Inputs:  params.id (campaign UUID), PATCH body: { status: 'active'|'paused'|'done' }
 * Outputs: { campaign, member_counts, total } on GET; { id, status } on PATCH
 * Used by: operator dashboard campaign detail + status toggle
 */
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const db = getDb();
  const { data: camp, error } = await db.from("call_campaigns").select("*").eq("id", params.id).single();
  if (error || !camp) return fail("campaign not found", 404);
  const { data: members } = await db
    .from("campaign_leads")
    .select("status")
    .eq("campaign_id", params.id);
  const counts: Record<string, number> = {};
  for (const m of members ?? []) counts[m.status] = (counts[m.status] ?? 0) + 1;
  return ok({ campaign: camp, member_counts: counts, total: members?.length ?? 0 });
});

const Patch = z.object({ status: z.enum(["active", "paused", "done"]) });

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  const db = getDb();
  const { data, error } = await db
    .from("call_campaigns")
    .update({ status: parsed.data.status })
    .eq("id", params.id)
    .select("id,status")
    .single();
  if (error || !data) return fail("campaign not found", 404);

  // Pause/resume must cascade to the members' sequence state, because the tick
  // fires on leads.seq_status, not on the campaign status. Pause: active→paused.
  // Resume: paused→active (keeps seq_next_step_at so it picks up where it left).
  const { data: members } = await db
    .from("campaign_leads")
    .select("lead_id")
    .eq("campaign_id", params.id);
  const leadIds = (members ?? []).map((m: { lead_id: string }) => m.lead_id);
  if (leadIds.length > 0) {
    if (parsed.data.status === "paused") {
      await db.from("leads").update({ seq_status: "paused" }).in("id", leadIds).eq("seq_status", "active");
    } else if (parsed.data.status === "active") {
      await db.from("leads").update({ seq_status: "active" }).in("id", leadIds).eq("seq_status", "paused");
    }
  }

  revalidateTag("campaigns");
  return ok(data);
});

// Delete a campaign + its membership. Halts any active sequence for its members
// first, so a deleted campaign can never keep sending (the scheduler would
// otherwise fall back to default windows for still-enrolled leads).
export const DELETE = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const db = getDb();

  const { data: members } = await db
    .from("campaign_leads")
    .select("lead_id")
    .eq("campaign_id", params.id);
  const leadIds = (members ?? []).map((m: { lead_id: string }) => m.lead_id);

  if (leadIds.length > 0) {
    await db
      .from("leads")
      .update({ seq_status: "stopped", seq_next_step_at: null })
      .in("id", leadIds)
      .eq("seq_status", "active");
  }

  await db.from("campaign_leads").delete().eq("campaign_id", params.id);
  const { error } = await db.from("call_campaigns").delete().eq("id", params.id);
  if (error) return fail(error.message, 502);
  revalidateTag("campaigns");
  return ok({ deleted: true, stopped_sequences: leadIds.length });
});
