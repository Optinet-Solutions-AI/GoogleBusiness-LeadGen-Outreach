/**
 * api/leads/[id]/handover/route.ts — Hand the deployed site to the customer.
 *
 * POST /api/leads/:id/handover  body: { mode: 'attach'|'transfer', custom_domain? }
 *
 * 'attach' (recommended): adds the customer's domain to our Cloudflare Pages
 *   project. Synchronous — returns DNS instructions to forward to the customer.
 * 'transfer': records intent only. Project transfer must be done by hand in
 *   the Cloudflare dashboard (no API for it).
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { run as runHandover } from "@/lib/pipeline/handover";
import { fail, ok } from "@/lib/response";

const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("attach"),
    custom_domain: z
      .string()
      .min(3)
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "must be a valid domain (e.g. joesplumbing.com)"),
  }),
  z.object({
    mode: z.literal("transfer"),
  }),
]);

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  const result = await runHandover(params.id, parsed.data);
  return ok(result);
});
