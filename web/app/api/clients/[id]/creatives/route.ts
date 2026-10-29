/**
 * api/clients/[id]/creatives/route.ts — GET: list posts (month/state/platform filters). POST: create one from a brief.
 *
 * Inputs:  params.id; GET ?month=YYYY-MM&state=&platform=; POST body { title, brief, template_key, kind, platforms, slot_date?, product_id? }
 * Outputs: GET { creatives } (with latest version summary); POST 201 { creative } (no render, no paid call)
 * Used by: Creative Studio (posts grid / "New post")
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getClient } from "@/lib/clients/clients";
import { createSingleCreative, listCreatives } from "@/lib/creatives/creatives";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";
import { CreativeKindSchema, PlatformSchema, TemplateKeySchema, VERSION_STATES } from "@/lib/creatives/types";

const Query = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  state: z.enum(VERSION_STATES).optional(),
  platform: PlatformSchema.optional(),
});

const Body = z.object({
  title: z.string().trim().min(1),
  brief: z.string().trim().min(1),
  template_key: TemplateKeySchema,
  kind: CreativeKindSchema,
  platforms: z.array(PlatformSchema).min(1),
  slot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
});

export const GET = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id)) return fail("client not found", 404);
  try {
    const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
    return ok({ creatives: await listCreatives(params.id, q) });
  } catch (e) {
    return mapCreativeError(e);
  }
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id) || !(await getClient(params.id))) return fail("client not found", 404);
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    return ok({ creative: await createSingleCreative(params.id, body) }, { status: 201 });
  } catch (e) {
    return mapCreativeError(e);
  }
});
