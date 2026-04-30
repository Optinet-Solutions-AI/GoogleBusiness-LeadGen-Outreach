/**
 * api/leads/[id]/improve/route.ts — Re-generate site with operator-supplied data.
 *
 * POST /api/leads/:id/improve  body: ImproveInput
 *   - rebuilds + redeploys the site using the customer's real photos/copy
 *   - flips lead.stage to 'improved'
 *
 * Long-running (Gemini call + Astro build + Cloudflare deploy). Dispatches
 * to Cloud Run when configured (MODE=improve LEAD_ID=… IMPROVE_PAYLOAD_BASE64=…),
 * falls back to in-process for local dev.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getLogger } from "@/lib/logger";
import { run as runImprove } from "@/lib/pipeline/improve";
import { fail, ok } from "@/lib/response";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";

const log = getLogger("api.leads.improve");

const Body = z.object({
  photos: z.array(z.string().url()).optional(),
  service_areas: z.array(z.string().min(1)).optional(),
  business_hours: z.record(z.string()).optional(),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  notes: z.string().max(4000).optional(),
  copy: z
    .object({
      hero_tagline: z.string().optional(),
      hero_subhead: z.string().optional(),
      trust_strip: z.array(z.string()).optional(),
      about_paragraph: z.string().optional(),
      about_why_us: z.array(z.string()).optional(),
      service_area_intro: z.string().optional(),
      contact_blurb: z.string().optional(),
      meta_description: z.string().optional(),
      services: z
        .array(
          z.object({
            slug: z.string(),
            name: z.string(),
            short_description: z.string(),
            detail_paragraph: z.string(),
            bullets: z.array(z.string()),
          }),
        )
        .optional(),
    })
    .partial()
    .optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  if (isCloudRunConfigured()) {
    const oidcToken =
      req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
    // Cloud Run Job env vars cap at 32KB. The improve payload is small
    // (URLs + short strings) and base64 only inflates ~33%, so well under.
    const payloadB64 = Buffer.from(JSON.stringify(parsed.data), "utf8").toString("base64");
    try {
      const op = await triggerJob(
        {
          MODE: "improve",
          LEAD_ID: params.id,
          IMPROVE_PAYLOAD_BASE64: payloadB64,
        },
        { oidcToken },
      );
      return ok(
        { id: params.id, status: "improving", runner: "cloud-run", operation: op.operationName },
        { status: 202 },
      );
    } catch (err) {
      log.error({ lead_id: params.id, err: String(err) }, "improve.trigger_failed");
      return fail(`Cloud Run trigger failed: ${String(err)}`, 502);
    }
  }

  // Local-dev path
  runImprove(params.id, parsed.data).catch((err) =>
    log.error({ lead_id: params.id, err: String(err) }, "improve.failed"),
  );
  return ok({ id: params.id, status: "improving", runner: "local" }, { status: 202 });
});
