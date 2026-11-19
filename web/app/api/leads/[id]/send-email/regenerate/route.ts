/**
 * api/leads/[id]/send-email/regenerate/route.ts — "Regenerate" in the Send email window: a fresh wording (Gemini).
 *
 * Inputs:  POST { subject, body, followUps?: string[] (max 2) } — what's in the window now
 * Outputs: { success, data: { subject, body, followUps } } · 503 with a plain reason when Gemini can't help
 * Used by: components/outreach/SimpleEmailModal.tsx. One free-tier Gemini call; nothing is sent.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { regenerateCopy } from "@/lib/email/regenerate-copy";
import { fail, ok } from "@/lib/response";

const Body = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  followUps: z.array(z.string().max(5000)).max(2).default([]),
});

export const POST = withApi(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);
  const r = await regenerateCopy(parsed.data);
  return "error" in r ? fail(r.error, 503) : ok(r.copy);
});
