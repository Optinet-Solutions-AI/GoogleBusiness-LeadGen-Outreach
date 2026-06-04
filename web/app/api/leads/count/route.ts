/**
 * api/leads/count/route.ts — How many leads are reachable for a channel (+ optional filters).
 *
 * GET ?channel=email|sms|dm|voice_agent[&segment=&country_code=&category=]
 *   → { count }   (the eligible pool — drives the New Campaign live count)
 *
 * Pure read, no paid calls. Mirrors the app-source filter in /api/campaigns.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { applyChannelEligibility } from "@/lib/campaigns/eligibility";

export const dynamic = "force-dynamic";

const Q = z.object({
  channel: z.enum(["voice_agent", "sms", "dm", "email"]),
  segment: z.enum(["no_website", "old_website", "has_website"]).optional(),
  country_code: z.string().optional(),
  category: z.string().optional(),
});

export const GET = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(", "), 400);
  const { channel, segment, country_code, category } = parsed.data;

  let q = getDb().from("leads").select("id", { count: "exact", head: true }).neq("qualified", false);
  q = applyChannelEligibility(q, channel);
  if (segment) q = q.eq("call_segment", segment);
  if (country_code) q = q.eq("country_code", country_code.toLowerCase());
  if (category) q = q.eq("category", category);

  const { count, error } = await q;
  if (error) return fail(error.message, 502);
  return ok({ count: count ?? 0 });
});
