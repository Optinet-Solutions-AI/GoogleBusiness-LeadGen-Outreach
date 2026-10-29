/**
 * api/pricing/creatives/route.ts — Creative Studio cost preview.
 *
 * GET /api/pricing/creatives?count=N&backgrounds=M → { usd }
 *
 * Pure function — no DB, no paid API calls.
 */
import { z } from "zod";
import { env } from "@/lib/config";
import { estimatePlanUsd } from "@/lib/creatives/cost";
import { fail, ok } from "@/lib/response";

const Q = z.object({
  count: z.coerce.number().int().min(1).max(20),
  backgrounds: z.coerce.number().int().min(0).max(20).default(0),
});

export async function GET(req: Request) {
  const parsed = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return fail(parsed.error.message, 400);
  const { count, backgrounds } = parsed.data;
  if (backgrounds > count) return fail("backgrounds cannot exceed count", 400);
  return ok({ usd: estimatePlanUsd(count, backgrounds, env.OPENAI_IMAGE_USD_PER_IMAGE) });
}
