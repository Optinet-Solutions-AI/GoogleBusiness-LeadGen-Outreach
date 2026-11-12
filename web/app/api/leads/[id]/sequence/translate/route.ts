/**
 * api/leads/[id]/sequence/translate/route.ts — translate the first email in the Send email preview.
 *
 * Inputs:  POST { subject, body } (plain text, as edited in the preview)
 * Outputs: { subject, body, language } in the lead's language — the operator reviews it before sending
 * Used by: components/outreach/EmailPreviewModal.tsx ("Translate to …" button). One Gemini call (free tier).
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { translateFirstEmail } from "@/lib/email/translate-copy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Subject and body are required", 400);
  const out = await translateFirstEmail(params.id, parsed.data);
  return "error" in out ? fail(out.error, 409) : ok(out);
});
