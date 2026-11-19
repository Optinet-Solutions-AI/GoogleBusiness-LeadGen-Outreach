/**
 * api/email-templates/[id]/restore/route.ts — bring back an old version (saved as the next version; nothing is lost).
 *
 * Inputs:  POST { version: number }
 * Outputs: { success, data: template } · 404 when that version doesn't exist
 * Used by: the Templates page (History → Restore)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { restoreVersion } from "@/lib/email/template-library";
import { fail, ok } from "@/lib/response";

const Body = z.object({ version: z.number().int().min(1) });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  const t = await restoreVersion(params.id, parsed.data.version);
  return t ? ok(t) : fail(`Version ${parsed.data.version} not found`, 404);
});
