/**
 * api/social-accounts/route.ts — the dedicated DM handle(s) the team sends from.
 *
 * GET  → { accounts: [{ id, platform, handle, profile_url, label, status }] } (active)
 * POST { platform, handle, profile_url?, label? } → { id }
 * Used by: the Social worklist page + ConnectSocialModal.
 *
 * Reference/config only — no Meta integration (cold-DM automation isn't allowed).
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const { data, error } = await getDb()
    .from("social_accounts")
    .select("id,platform,handle,profile_url,label,status,created_at")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) return fail(error.message, 502);
  return ok({ accounts: data ?? [] });
});

const Body = z.object({
  platform: z
    .enum(["instagram", "facebook", "tiktok", "linkedin", "twitter", "other"])
    .default("instagram"),
  handle: z.string().min(1),
  profile_url: z.string().url().optional().or(z.literal("")),
  label: z.string().optional(),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("A platform and handle are required", 400);
  const b = parsed.data;
  const { data, error } = await getDb()
    .from("social_accounts")
    .insert({
      platform: b.platform,
      handle: b.handle.trim(),
      profile_url: b.profile_url ? b.profile_url : null,
      label: b.label?.trim() || null,
      status: "active",
    })
    .select("id")
    .single();
  if (error) return fail(error.message, 502);
  return ok({ id: data?.id });
});
