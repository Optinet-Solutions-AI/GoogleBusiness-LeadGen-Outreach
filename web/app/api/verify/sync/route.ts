/**
 * api/verify/sync/route.ts — POST { leadIds: string[] } (≤5): verify now, inline.
 * For quick re-checks from the UI. Heavy batches go through the Cloud Run job.
 *
 * Inputs:  JSON body { leadIds: uuid[] (1–5) }
 * Outputs: { results: { [leadId]: status } }
 * Used by: operator dashboard (quick re-check button)
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { verifyLead } from "@/lib/verify/verify-lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(5) });

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("leadIds (1–5 uuids) required", 400);
  const { data } = await getDb().from("leads").select("id,email").in("id", parsed.data.leadIds);
  const leads = (data ?? []) as { id: string; email: string | null }[];
  const results: Record<string, string> = {};
  for (const lead of leads) {
    const r = await verifyLead(lead);
    results[lead.id] = r?.status ?? "skipped";
  }
  return ok({ results });
});
