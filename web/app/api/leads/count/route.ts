/**
 * api/leads/count/route.ts — Which leads are reachable for a channel (+ filters).
 *
 * GET ?channel=email|sms|dm[&segment=&country_code=&category=]
 *   → { count, sample[] }   count = the eligible pool; sample = up to 8 matching
 *     leads so the New Campaign wizard can SHOW what's available, not just a number.
 *
 * Pure read, no paid calls. Mirrors the app-source filter in /api/campaigns.
 * Channels: sms | dm | email (voice_agent removed).
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { applyChannelEligibility } from "@/lib/campaigns/eligibility";

export const dynamic = "force-dynamic";

const SAMPLE_SIZE = 50;

const Q = z.object({
  channel: z.enum(["sms", "dm", "email"]),
  segment: z.enum(["no_website", "old_website", "has_website"]).optional(),
  country_code: z.string().optional(),
  category: z.string().optional(),
});

export const GET = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(", "), 400);
  const { channel, segment, country_code, category } = parsed.data;

  // One query: `count: 'exact'` gives the full total regardless of the limit,
  // and the limited rows are the preview sample.
  let q = getDb()
    .from("leads")
    .select("id,business_name,address,country_code,category,email,phone,website_kind", {
      count: "exact",
    })
    .neq("qualified", false);
  q = applyChannelEligibility(q, channel);
  if (segment) q = q.eq("call_segment", segment);
  if (country_code) q = q.eq("country_code", country_code.toLowerCase());
  if (category) q = q.eq("category", category);
  q = q.order("updated_at", { ascending: false }).limit(SAMPLE_SIZE);

  const { data, count, error } = await q;
  if (error) return fail(error.message, 502);
  return ok({ count: count ?? 0, sample: data ?? [] });
});
