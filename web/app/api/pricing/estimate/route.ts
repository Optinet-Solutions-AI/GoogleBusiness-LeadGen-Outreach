/**
 * api/pricing/estimate/route.ts — Single-scraper cost preview.
 *
 * GET /api/pricing/estimate?scraper=google_places|outscraper&limit=N
 *   → { success: true, data: Estimate }
 *
 * Pure function — no DB, no paid API calls. Safe to call as the user types.
 */

import { z } from "zod";
import { estimate } from "@/lib/pricing";
import { fail, ok } from "@/lib/response";

const Q = z.object({
  scraper: z.enum(["google_places", "outscraper"]).default("google_places"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(parsed.error.message, 422);
  return ok(estimate(parsed.data.scraper, parsed.data.limit));
}
