/**
 * api/pricing/compare/route.ts — Side-by-side cost preview for both scrapers.
 *
 * GET /api/pricing/compare?limit=N
 *   → { success: true, data: { outscraper: Estimate, google_places: Estimate } }
 */

import { z } from "zod";
import { compare } from "@/lib/pricing";
import { fail, ok } from "@/lib/response";

const Q = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(parsed.error.message, 422);
  return ok(compare(parsed.data.limit));
}
