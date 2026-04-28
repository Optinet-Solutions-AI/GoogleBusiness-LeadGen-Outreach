/**
 * api/batches/route.ts — Create / list batches.
 *
 * POST /api/batches  body: { niche, city, template_slug, scraper, limit }
 *   → creates row with status='queued'; returns { id, estimated_cost_usd, ... }
 *   The actual pipeline run is triggered by the operator via
 *     `npm run --prefix web run:batch <id>`  OR  POST /api/batches/:id/run
 *
 * GET /api/batches → list, most recent 50
 */

import { z } from "zod";
import { getDb } from "@/lib/db";
import { estimate } from "@/lib/pricing";
import { createBatch } from "@/lib/pipeline/orchestrator";
import { fail, ok } from "@/lib/response";

const Body = z.object({
  niche: z.string().min(1),
  city: z.string().min(1),
  template_slug: z.string().min(1).default("trades"),
  scraper: z.enum(["google_places", "outscraper"]).default("google_places"),
  limit: z.number().int().min(1).max(500).default(100),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  const est = estimate(parsed.data.scraper, parsed.data.limit);
  const { id, estimated_cost_usd } = await createBatch(parsed.data);

  return ok({
    id,
    status: "queued",
    scraper: parsed.data.scraper,
    estimated_cost_usd,
    effective_limit: est.effective_limit,
    warnings: est.warnings,
  });
}

export async function GET() {
  const { data, error } = await getDb()
    .from("batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return fail(error.message, 500);
  return ok(data ?? []);
}
