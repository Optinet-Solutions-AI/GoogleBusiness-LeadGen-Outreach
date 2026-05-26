/**
 * api/batches/route.ts — Create / list batches.
 *
 * POST /api/batches  body: { niche, city, country_code, scraper, limit }
 *   → creates row with status='queued'; returns { id, estimated_cost_usd, ... }
 *   `template_slug` is derived from the niche server-side (see
 *   templateForNiche). Power users can still override it via the body.
 *
 * GET /api/batches → list, most recent 50
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { estimate } from "@/lib/pricing";
import { createBatch } from "@/lib/pipeline/orchestrator";
import { templateForNiche } from "@/lib/data/niches";
import { fail, ok } from "@/lib/response";

const Body = z.object({
  niche: z.string().min(1),
  city: z.string().min(1),
  // ISO 3166-1 alpha-2, lowercase. Used as Places `regionCode` /
  // Outscraper `region` to bias the scrape to that country.
  country_code: z.string().toLowerCase().regex(/^[a-z]{2}$/).default("us"),
  // Optional. The dashboard no longer exposes a template picker — the
  // server derives the slug from the niche. Kept here as an escape hatch
  // for the CLI / tests / power users.
  template_slug: z.string().min(1).optional(),
  scraper: z.enum(["google_places", "outscraper"]).default("google_places"),
  limit: z.number().int().min(1).max(500).default(100),
});

export const POST = withApi(async (req: Request) => {
  if (!isDbConfigured()) {
    return fail("Supabase not configured. Set SUPABASE_URL + SUPABASE_SERVICE_KEY in Vercel.", 503);
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  const template_slug = parsed.data.template_slug ?? templateForNiche(parsed.data.niche);

  const est = estimate(parsed.data.scraper, parsed.data.limit);
  const { id, estimated_cost_usd } = await createBatch({ ...parsed.data, template_slug });

  return ok({
    id,
    status: "queued",
    scraper: parsed.data.scraper,
    estimated_cost_usd,
    effective_limit: est.effective_limit,
    warnings: est.warnings,
  });
});

export const GET = withApi(async () => {
  if (!isDbConfigured()) {
    return ok([]);
  }
  const { data, error } = await getDb()
    .from("batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return fail(error.message, 500);
  return ok(data ?? []);
});
