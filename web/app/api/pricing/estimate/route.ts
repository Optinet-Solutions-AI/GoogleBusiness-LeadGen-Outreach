/**
 * api/pricing/estimate/route.ts — Single-scraper cost preview.
 *
 * GET /api/pricing/estimate?scraper=<any of SCRAPERS in lib/pricing.ts>&limit=N
 *   → { success: true, data: Estimate }
 *
 * Pure function — no DB, no paid API calls. Safe to call as the user types.
 */

import { z } from "zod";
import { estimate, SCRAPERS } from "@/lib/pricing";
import { env } from "@/lib/config";
import { fail, ok } from "@/lib/response";

const Q = z.object({
  scraper: z.enum(SCRAPERS).default("apify"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** ai=0: "Run AI Lookup on every lead" unticked in the New batch form — no AI line in the estimate. */
  ai: z.enum(["0", "1"]).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(parsed.error.message, 422);
  return ok(estimate(parsed.data.scraper, parsed.data.limit, { aiCap: parsed.data.ai === "0" ? 0 : env.CONTACT_AI_MAX_PER_BATCH, siteCap: env.WEBSITE_AI_MAX_PER_BATCH }));
}
