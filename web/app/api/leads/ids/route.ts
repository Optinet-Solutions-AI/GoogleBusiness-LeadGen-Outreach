/**
 * api/leads/ids/route.ts — matching lead-id list for select-all
 *
 * Inputs:  ?stage= (optional) — mirror the filter from (dashboard)/leads/page.tsx
 * Outputs: { ids: string[] } — up to LIMIT ids in updated_at desc order
 * Used by: Leads table "select all N matching" UI (cross-page selection)
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const LIMIT = 5000;

export const GET = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage") ?? undefined;

  let q = getDb().from("leads").select("id").order("updated_at", { ascending: false }).limit(LIMIT);
  if (stage) q = q.eq("stage", stage);

  const { data, error } = await q;
  if (error) return fail(error.message, 502);
  return ok({ ids: (data ?? []).map((r: { id: string }) => r.id) });
});
