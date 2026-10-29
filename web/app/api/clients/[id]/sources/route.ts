/**
 * api/clients/[id]/sources/route.ts — POST: attach a source. DELETE: remove one by id.
 *
 * Inputs:  POST body { kind, url? }; DELETE body { source_id }
 * Outputs: { source } on POST; { deleted: true } on DELETE
 * Used by: client detail page (Sources panel)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { getClient } from "@/lib/clients/clients";
import { attachSource, removeSource } from "@/lib/clients/sources";
import { SourceKind } from "@/lib/clients/types";

const Attach = z.object({ kind: SourceKind, url: z.string().trim().url().nullish() });
const Remove = z.object({ source_id: z.string().uuid() });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Attach.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  if (!(await getClient(params.id))) return fail("client not found", 404);
  return ok({ source: await attachSource(params.id, parsed.data) });
});

export const DELETE = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Remove.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  await removeSource(params.id, parsed.data.source_id);
  return ok({ deleted: true });
});
