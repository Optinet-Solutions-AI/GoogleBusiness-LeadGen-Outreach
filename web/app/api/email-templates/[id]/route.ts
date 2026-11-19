/**
 * api/email-templates/[id]/route.ts — read one saved template, save an edit (new version), or archive / unarchive.
 *
 * Inputs:  GET · PATCH { ...TemplateInput } (edit → next version) or { archived: boolean }
 * Outputs: { success, data: template }
 * Used by: the Templates page
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { archiveTemplate, getTemplate, TemplateInputSchema, updateTemplate } from "@/lib/email/template-library";
import { fail, ok } from "@/lib/response";

const Archive = z.object({ archived: z.boolean() }).strict();

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const t = await getTemplate(params.id);
  return t ? ok(t) : fail("Template not found", 404);
});

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const json = await req.json().catch(() => null);
  try {
    const archive = Archive.safeParse(json);
    if (archive.success) return ok(await archiveTemplate(params.id, archive.data.archived));
    const parsed = TemplateInputSchema.safeParse(json);
    if (!parsed.success) return fail(parsed.error.message, 422);
    return ok(await updateTemplate(params.id, parsed.data));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 503);
  }
});
