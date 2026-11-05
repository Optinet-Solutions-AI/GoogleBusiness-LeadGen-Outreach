/**
 * api/ads/pulls/route.ts — competitor ad pulls.
 *
 * GET  → { pulls: PullRow[] } (last 20)
 * POST { source_url? | query?, country?, media_type?, active_only?, max_results?, client_id? } → 202 { id, status, runner, estimate_usd }
 *      PAID: about APIFY_ADS_USD_PER_AD per ad. Runs on Cloud Run (MODE=ad-pull) or in-process locally.
 * Used by: components/ads/AdLibrary.tsx
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { env } from "@/lib/config";
import { dispatchJob } from "@/lib/creatives/dispatch";
import { isAdsPullConfigured, pullCostUsd } from "@/lib/services/apify-ads";
import { createPull, listPulls, PullInputError, runPull } from "@/lib/ads/pulls";

export const dynamic = "force-dynamic";

const Body = z.object({
  source_url: z.string().url().optional().nullable(),
  query: z.string().max(120).optional().nullable(),
  country: z.string().length(2).optional(),
  media_type: z.enum(["all", "video", "image"]).optional(),
  active_only: z.boolean().optional(),
  max_results: z.number().int().min(1).max(env.ADS_MAX_PER_PULL).optional(),
  client_id: z.string().uuid().optional().nullable(),
});

export const GET = withApi(async () => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  return ok({ pulls: await listPulls() });
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!isAdsPullConfigured()) return fail("APIFY_TOKEN is not set", 503);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  let pull;
  try {
    pull = await createPull(parsed.data);
  } catch (err) {
    if (err instanceof PullInputError) return fail(err.message, 400);
    if (/ad_pulls/.test(String(err))) return fail("Ad Library needs migration 056", 503);
    throw err;
  }
  return dispatchJob(req, {
    vars: { MODE: "ad-pull", PULL_ID: pull.id },
    status: "queued",
    local: () => runPull(pull.id),
    extra: { id: pull.id, estimate_usd: pullCostUsd(pull.max_results) },
  });
});
