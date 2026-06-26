/**
 * api/campaigns/route.ts — POST: create a campaign + snapshot its leads. GET: list.
 *
 * POST body (app source):    { name, source:'app', segment, country_code, category?, target_count, schedule }
 * POST body (csv/manual):    { name, source, segment, lead_ids[], schedule }
 *   schedule = { call_days?, call_start_hour?, call_end_hour? } (defaults 9-20 Mon-Fri)
 * Snapshots membership into campaign_leads. status starts 'active' (no auto-build in 2a).
 * Channels: sms | dm | email (voice_agent removed).
 */
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { selectSnapshot, type Candidate } from "@/lib/campaigns/select";
import { applyChannelEligibility } from "@/lib/campaigns/eligibility";
import { addMembers } from "@/lib/campaigns/add-members";
import { campaignTimezone } from "@/lib/call-hours";

const SEGMENTS = ["no_website", "old_website", "has_website"] as const;
const Body = z.object({
  name: z.string().min(1),
  source: z.enum(["app", "csv", "manual"]).default("app"),
  segment: z.enum(SEGMENTS).optional(),
  channel: z.enum(["sms", "dm", "email"]).optional(),
  country_code: z.string().optional(),
  category: z.string().optional(),
  target_count: z.number().int().positive().max(5000).optional(),
  lead_ids: z.array(z.string().uuid()).optional(),
  sender_email: z.string().optional(),
  sender_emails: z.array(z.string()).optional(),
  call_days: z.array(z.number().int().min(1).max(7)).optional(),
  call_start_hour: z.number().int().min(0).max(23).optional(),
  call_end_hour: z.number().int().min(0).max(23).optional(),
  // Per-step copy overrides: { "1": { subject?, body? }, ... }
  copy_overrides: z
    .record(z.object({ subject: z.string().nullish(), body: z.string().nullish() }))
    .optional(),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  const b = parsed.data;
  const db = getDb();

  // Resolve the membership lead-id list. Explicit selection wins; the old
  // target_count snapshot remains as a fallback for app source without ids.
  if (!b.channel) return fail("channel is required", 400);
  let leadIds: string[] = [];
  if (b.lead_ids?.length) {
    leadIds = b.lead_ids;
  } else if (b.source === "app" && b.target_count) {
    let q = db
      .from("leads")
      .select("id,created_at,lifecycle_stage")
      .neq("qualified", false)
      .limit(20000);
    q = applyChannelEligibility(q, b.channel);
    if (b.segment) q = q.eq("call_segment", b.segment);
    if (b.country_code) q = q.eq("country_code", b.country_code.toLowerCase());
    if (b.category) q = q.eq("category", b.category);
    const { data: cands, error } = await q;
    if (error) return fail(`lead query failed: ${error.message}`, 502);
    leadIds = selectSnapshot((cands ?? []) as Candidate[], b.target_count);
  } else {
    return fail("provide lead_ids (or target_count for an app snapshot)", 400);
  }
  if (leadIds.length === 0) return fail("No leads selected", 400);

  const { data: camp, error: cErr } = await db
    .from("call_campaigns")
    .insert({
      name: b.name,
      source: b.source,
      segment: b.segment ?? null,
      channel: b.channel ?? null,
      country_code: b.country_code?.toLowerCase() ?? null,
      category: b.category ?? null,
      sender_email: b.channel === "email" ? (b.sender_email ?? null) : null,
      sender_emails:
        b.channel === "email"
          ? (b.sender_emails ?? (b.sender_email ? [b.sender_email] : null))
          : null,
      target_count: b.target_count ?? leadIds.length,
      call_days: b.call_days ?? [1, 2, 3, 4, 5],
      call_start_hour: b.call_start_hour ?? 9,
      call_end_hour: b.call_end_hour ?? 20,
      copy_overrides:
        b.channel === "email" && b.copy_overrides && Object.keys(b.copy_overrides).length
          ? b.copy_overrides
          : null,
      timezone: campaignTimezone(b.country_code),
      // Created as a DRAFT — creating a campaign must NOT start sending. The
      // operator runs a test send (QA) and then explicitly launches it, which
      // is when members are enrolled into the sequence. See the launch route.
      status: "draft",
    })
    .select("*")
    .single();
  if (cErr || !camp) return fail(`campaign insert failed: ${cErr?.message}`, 502);

  const added = await addMembers(
    db,
    { id: (camp as { id: string }).id, channel: b.channel },
    leadIds,
  );

  // Bust the cached campaigns list so the new campaign shows immediately.
  revalidateTag("campaigns");
  return ok({ campaign: camp, ...added });
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
