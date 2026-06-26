/**
 * api/inbox/lead-search/route.ts — typeahead lead lookup for "Compose new".
 *
 * Inputs:  ?q= (matches business_name or email), only leads WITH an email
 * Outputs: { leads: [{ id, business_name, email }] } (max 10)
 * Used by: the inbox Compose modal.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const Q = z.object({ q: z.string().min(1).max(120) });

export const GET = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return ok({ leads: [] });
  const q = parsed.data.q.replace(/[%,]/g, " ").trim();

  const { data, error } = await getDb()
    .from("leads")
    .select("id,business_name,email")
    .not("email", "is", null)
    .or(`business_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) return fail(error.message, 502);
  return ok({ leads: data ?? [] });
});
