/**
 * api/campaigns/route.ts — POST: create a campaign + snapshot its leads. GET: list.
 *
 * POST body (app source):    { name, source:'app', segment, country_code, category?, target_count, schedule }
 * POST body (csv/manual):    { name, source, segment, lead_ids[], schedule }
 *   schedule = { call_days?, call_start_hour?, call_end_hour? } (defaults 9-20 Mon-Fri)
 * Snapshots membership into campaign_leads. status starts 'active' (no auto-build in 2a).
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { selectSnapshot, type Candidate } from "@/lib/campaigns/select";
import { campaignTimezone } from "@/lib/call-hours";

const SEGMENTS = ["no_website", "old_website", "has_website"] as const;
const Body = z.object({
  name: z.string().min(1),
  source: z.enum(["app", "csv", "manual"]).default("app"),
  segment: z.enum(SEGMENTS).optional(),
  country_code: z.string().optional(),
  category: z.string().optional(),
  target_count: z.number().int().positive().max(5000).optional(),
  lead_ids: z.array(z.string().uuid()).optional(),
  call_days: z.array(z.number().int().min(1).max(7)).optional(),
  call_start_hour: z.number().int().min(0).max(23).optional(),
  call_end_hour: z.number().int().min(0).max(23).optional(),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  const b = parsed.data;
  const db = getDb();

  // Resolve the snapshot lead-id list.
  let leadIds: string[] = [];
  if (b.source === "app") {
    if (!b.segment || !b.target_count) return fail("app source needs segment + target_count", 400);
    let q = db
      .from("leads")
      .select("id,created_at,lifecycle_stage")
      .eq("call_segment", b.segment)
      .neq("qualified", false)
      .limit(20000);
    if (b.country_code) q = q.eq("country_code", b.country_code.toLowerCase());
    if (b.category) q = q.eq("category", b.category);
    const { data: cands, error } = await q;
    if (error) return fail(`lead query failed: ${error.message}`, 502);
    leadIds = selectSnapshot((cands ?? []) as Candidate[], b.target_count);
  } else {
    if (!b.lead_ids?.length) return fail(`${b.source} source needs lead_ids`, 400);
    leadIds = b.lead_ids;
  }
  if (leadIds.length === 0) return fail("No matching leads to snapshot", 400);

  const { data: camp, error: cErr } = await db
    .from("call_campaigns")
    .insert({
      name: b.name,
      source: b.source,
      segment: b.segment ?? null,
      country_code: b.country_code?.toLowerCase() ?? null,
      category: b.category ?? null,
      target_count: b.target_count ?? leadIds.length,
      call_days: b.call_days ?? [1, 2, 3, 4, 5],
      call_start_hour: b.call_start_hour ?? 9,
      call_end_hour: b.call_end_hour ?? 20,
      timezone: campaignTimezone(b.country_code),
      status: "active",
    })
    .select("*")
    .single();
  if (cErr || !camp) return fail(`campaign insert failed: ${cErr?.message}`, 502);

  const membership = leadIds.map((lead_id) => ({ campaign_id: (camp as { id: string }).id, lead_id }));
  const { error: mErr } = await db.from("campaign_leads").insert(membership);
  if (mErr) return fail(`membership insert failed: ${mErr.message}`, 502);

  return ok({ campaign: camp, snapshot_count: leadIds.length });
});

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const { data, error } = await getDb()
    .from("call_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return fail(error.message, 502);
  return ok({ campaigns: data ?? [] });
});
