/**
 * api/leads/ids/route.ts — matching lead-id list for select-all
 *
 * Inputs:  ?stage= + ?email=has|missing (optional) — mirror (dashboard)/leads/page.tsx
 * Outputs: { ids: string[] } — up to LIMIT ids in updated_at desc order
 * Used by: Leads table "select all N matching" UI (cross-page selection)
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { applyEmailFilter, parseEmailFilter } from "@/lib/leads-filter";

export const dynamic = "force-dynamic";

const LIMIT = 5000;

export const GET = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage") ?? undefined;
  const email = parseEmailFilter(url.searchParams.get("email"));

  let q = getDb().from("leads").select("id").order("updated_at", { ascending: false }).limit(LIMIT);
  if (stage) q = q.eq("stage", stage);
  q = applyEmailFilter(q, email);

  const { data, error } = await q;
  if (error) return fail(error.message, 502);
  return ok({ ids: (data ?? []).map((r: { id: string }) => r.id) });
});
