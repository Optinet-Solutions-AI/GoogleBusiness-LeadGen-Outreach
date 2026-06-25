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
import { enrollableMemberIds } from "@/lib/campaigns/enroll-members";
import { enrollLeadInSequence } from "@/lib/pipeline/sequence-scheduler";
import { getLogger } from "@/lib/logger";

const log = getLogger("campaigns");

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
      timezone: campaignTimezone(b.country_code),
      status: "active",
    })
    .select("*")
    .single();
  if (cErr || !camp) return fail(`campaign insert failed: ${cErr?.message}`, 502);

  const added = await addMembers(
    db,
    { id: (camp as { id: string }).id, channel: b.channel },
    leadIds,
  );

  // For email campaigns: enroll each member in the screenshot-first sequence.
  // Enrollment failure must NOT fail campaign creation.
  if (b.channel === "email") {
    try {
      const { data: memberRows, error: mErr } = await db
        .from("leads")
        .select("id,email,seq_status")
        .in("id", leadIds);
      if (mErr) {
        log.warn({ err: mErr.message }, "campaign enroll: failed to load member rows");
      } else {
        const toEnroll = enrollableMemberIds(
          (memberRows ?? []) as { id: string; email: string | null; seq_status: string | null }[],
        );
        await Promise.all(
          toEnroll.map(async (id) => {
            try {
              await enrollLeadInSequence(id);
            } catch (err) {
              log.warn({ leadId: id, err }, "campaign enroll: enrollLeadInSequence failed");
            }
          }),
        );
      }
    } catch (err) {
      log.warn({ err }, "campaign enroll: unexpected error during enrollment");
    }
  }

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
