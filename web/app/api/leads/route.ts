/**
 * api/leads/route.ts — List leads with filters (GET); add a single lead by hand (POST).
 *
 * GET  /api/leads?batch_id=...&stage=...&limit=N
 * POST /api/leads  { business_name?, phone, city?, country_code?, website_url? }
 */

import { z } from "zod";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { validateLeadInput, buildLeadRow } from "@/lib/leads/import";
import { ensureImportBatch } from "@/lib/campaigns/import-batch";

const Q = z.object({
  batch_id: z.string().uuid().optional(),
  stage: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(parsed.error.message, 422);

  let q = getDb()
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit);
  if (parsed.data.batch_id) q = q.eq("batch_id", parsed.data.batch_id);
  if (parsed.data.stage) q = q.eq("stage", parsed.data.stage);

  const { data, error } = await q;
  if (error) return fail(error.message, 500);
  return ok(data ?? []);
}

// ---------------------------------------------------------------------------
// POST — add a single lead by hand (manual source)
// ---------------------------------------------------------------------------

const PostBody = z.object({
  business_name: z.string().optional(),
  phone: z.string(),
  city: z.string().optional(),
  country_code: z.string().optional(),
  website_url: z.string().optional(),
  // Operator-chosen outreach segment (build / improve / AI-services).
  segment: z.enum(["no_website", "old_website", "has_website"]).optional(),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);

  const v = validateLeadInput(parsed.data, "manual");
  if (!v.ok) return fail(v.error, 400);

  const db = getDb();
  const batchId = await ensureImportBatch(db, "manual add");
  const row = buildLeadRow(v.lead, batchId, parsed.data.segment);
  const { data, error } = await db.from("leads").insert(row).select("id").single();
  if (error) return fail(`insert failed: ${error.message}`, 502);
  return ok({ lead_id: data.id, batch_id: batchId });
});
