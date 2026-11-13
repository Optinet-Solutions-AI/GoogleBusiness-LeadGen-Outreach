/**
 * api/leads/[id]/send-email/route.ts — the "Send email" window: load what it needs, then send.
 *
 * Inputs:  GET  params.id
 *          POST params.id + body { subject, body (plain text), senderEmail?, followUps? (max 2, plain text) }
 * Outputs: GET  ComposeContext (to, address status in words, details the service templates fill, the service
 *               that fits the lead, follow-ups already running?)
 *          POST { sent: true, via, checked, followUps, note? } | 409 with the plain reason (paused, unsubscribed,
 *               bad address, checker out of credits, …)
 * Used by: components/outreach/SimpleEmailModal.tsx (lead page Contact card, next-step banner, Leads list)
 *
 * Thin: validate → lib/email/compose-context.ts / lib/email/send-simple.ts. A never-checked address is checked
 * first (under 1 cent). Follow-ups go out 4 days apart and stop on a reply.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { sendSimpleEmail, MAX_FOLLOW_UPS } from "@/lib/email/send-simple";
import { loadComposeContext } from "@/lib/email/compose-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  subject: z.string().trim().min(1, "Write a subject first").max(200, "Subject is too long (200 characters max)"),
  body: z.string().trim().min(1, "Write the email first").max(10000, "Email is too long (10,000 characters max)"),
  senderEmail: z.string().email().optional(),
  followUps: z
    .array(z.string().trim().min(1, "A follow-up is empty: write it or choose fewer follow-ups").max(10000, "A follow-up is too long"))
    .max(MAX_FOLLOW_UPS)
    .optional(),
});

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const ctx = await loadComposeContext(params.id);
  return ctx ? ok(ctx) : fail("Lead not found", 404);
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const result = await sendSimpleEmail(params.id, parsed.data);
  return result.sent ? ok(result) : fail(result.message, 409);
});
