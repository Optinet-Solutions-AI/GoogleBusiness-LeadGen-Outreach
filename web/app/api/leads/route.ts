/**
 * api/leads/route.ts — List leads with filters.
 *
 * GET /api/leads?batch_id=...&stage=...&limit=N
 */

import { z } from "zod";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

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
