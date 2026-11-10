/**
 * api/pricing/compare/route.ts — Side-by-side cost preview for both scrapers.
 *
 * GET /api/pricing/compare?limit=N
 *   → { success: true, data: { apify: Estimate, outscraper: Estimate, google_places: Estimate } }
 */

import { z } from "zod";
import { compare } from "@/lib/pricing";
import { env } from "@/lib/config";
import { fail, ok } from "@/lib/response";

const Q = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(parsed.error.message, 422);
  return ok(compare(parsed.data.limit, { aiCap: env.CONTACT_AI_MAX_PER_BATCH }));
}
