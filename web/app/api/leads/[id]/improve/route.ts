/**
 * api/leads/[id]/improve/route.ts — Re-generate site with operator-supplied data.
 *
 * POST /api/leads/:id/improve  body: ImproveInput
 *   - rebuilds + redeploys the site using the customer's real photos/copy
 *   - flips lead.stage to 'improved'
 *
 * Long-running (Gemini call + Astro build + Cloudflare deploy). Fire-and-forget;
 * client should poll /api/leads/:id for the new stage.
 */

import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { run as runImprove } from "@/lib/pipeline/improve";
import { fail, ok } from "@/lib/response";

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

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  runImprove(params.id, parsed.data).catch((err) =>
    log.error({ lead_id: params.id, err: String(err) }, "improve.failed"),
  );
  return ok({ id: params.id, status: "improving" }, { status: 202 });
}
