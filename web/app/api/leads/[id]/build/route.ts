/**
 * api/leads/[id]/build/route.ts — Operator clicks "Build website" on a lead.
 *
 * POST /api/leads/:id/build
 *   - Locally: runs stages 2 → 3 → 4 (enrich, generate, deploy) for this lead.
 *   - On Vercel: returns 501 Not Implemented with instructions.
 *
 * Why Vercel can't do it:
 *   Stage 3 calls `npm run build` inside templates/trades/ to produce the
 *   static HTML. That requires:
 *     - a writable filesystem (Vercel: only /tmp, ephemeral per-invocation)
 *     - npm + node_modules cache between invocations (Vercel: cold start each time)
 *     - long execution (Astro install+build = ~30–90s; Hobby cap is 10s)
 *   Move stages 2–4 to a long-lived worker (a tiny VPS, a single
 *   long-running container, or Inngest's durable functions) for production.
 *
 * Local path (works today):
 *   npm run --prefix web run:lead-build <lead_id>
 */

import { buildLead } from "@/lib/pipeline/build-lead";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";

const log = getLogger("api.leads.build");

const isServerless = Boolean(process.env.VERCEL);

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  if (isServerless) {
    return fail(
      `Stage 3 (build) cannot run on Vercel's serverless functions — it needs a writable filesystem + long execution time. Run from your repo: npm run --prefix web run:lead-build ${params.id}`,
      501,
    );
  }

  // Local / long-lived host: fire-and-forget. Operator polls the lead row
  // for stage='deployed' or last_error.
  buildLead(params.id).catch((err) =>
    log.error({ lead_id: params.id, err: String(err) }, "build.failed"),
  );
  return ok({ id: params.id, status: "building" }, { status: 202 });
});
