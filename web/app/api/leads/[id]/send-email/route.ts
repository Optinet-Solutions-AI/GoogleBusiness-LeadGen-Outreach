/**
 * api/leads/[id]/send-email/route.ts — POST: send one plain email to a lead, written by the operator.
 *
 * Inputs:  params.id + body { subject, body (plain text), senderEmail? }
 * Outputs: { sent: true, via, checked } | 409 with the plain reason (paused, unsubscribed, bad address, …)
 * Used by: components/outreach/SimpleEmailModal.tsx (lead page Contact card "Send email")
 *
 * Thin: validate → lib/email/send-simple.ts. No pitch, no follow-ups. A never-checked address is checked
 * first (under 1 cent).
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { sendSimpleEmail } from "@/lib/email/send-simple";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  subject: z.string().trim().min(1, "Write a subject first").max(200, "Subject is too long (200 characters max)"),
  body: z.string().trim().min(1, "Write the email first").max(10000, "Email is too long (10,000 characters max)"),
  senderEmail: z.string().email().optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const result = await sendSimpleEmail(params.id, parsed.data);
  return result.sent ? ok(result) : fail(result.message, 409);
});
