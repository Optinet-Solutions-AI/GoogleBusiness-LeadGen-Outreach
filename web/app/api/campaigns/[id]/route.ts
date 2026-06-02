/**
 * api/campaigns/[id]/route.ts — GET: campaign + membership counts. PATCH: status.
 *
 * PATCH body: { status: 'active'|'paused'|'done' }
 */
import { z } from "zod";
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
  const { data, error } = await getDb()
    .from("call_campaigns")
    .update({ status: parsed.data.status })
    .eq("id", params.id)
    .select("id,status")
    .single();
  if (error) return fail(error.message, 502);
  return ok(data);
});
