/**
 * api/email-templates/route.ts — list saved email templates / save a new one (migration 064).
 *
 * Inputs:  GET ?archived=1 (include archived) · POST TemplateInput { name, service_key?, subject, body, follow_up_1?, follow_up_2? }
 * Outputs: { success, data: { templates, missing } } · { success, data: template } (version 1 saved in the history)
 * Used by: the Templates page, Send email ("Saved" templates + "Save as template")
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { createTemplate, listTemplates, TemplateInputSchema } from "@/lib/email/template-library";
import { fail, ok } from "@/lib/response";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req: Request) => {
  if (!isDbConfigured()) return ok({ templates: [], missing: true });
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  return ok(await listTemplates({ includeArchived }));
});

export const POST = withApi(async (req: Request) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = TemplateInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  try {
    return ok(await createTemplate(parsed.data));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 503);
  }
});
