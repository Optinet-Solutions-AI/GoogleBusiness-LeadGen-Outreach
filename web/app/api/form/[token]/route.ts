/**
 * api/form/[token]/route.ts — public submit endpoint for the one-time intake form.
 *
 * POST { name?, email?, bestTime?, details? } → atomically claims the one-time link, records the
 * submission, and lands the lead in the inbox for follow-up.
 * Used by: components/IntakeForm.tsx
 *
 * Single-use is enforced by consumeFormLink()'s atomic UPDATE latch — a replayed/again-clicked link
 * returns 409. No auth: the token IS the credential. (RLS is off; this route self-gates by token.)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { consumeFormLink } from "@/lib/form-links";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  bestTime: z.string().max(200).optional(),
  details: z.string().max(2000).optional(),
});

export const POST = withApi(async (req, ctx) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const token = ctx?.params?.token;
  if (!token) return fail("Missing token", 400);

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid form data", 400);
  const answers = parsed.data;

  // Atomic single-use claim — 0 rows means already used / expired / unknown.
  const claimed = await consumeFormLink(token);
  if (!claimed) return fail("This link has already been used or has expired.", 409);

  const db = getDb();
  await db.from("form_submissions").insert({
    lead_id: claimed.leadId,
    form_link_id: claimed.formLinkId,
    answers,
  });

  // Land in the inbox for human follow-up.
  await db
    .from("leads")
    .update({ inbox_status: "open", inbox_owner: "unassigned" })
    .eq("id", claimed.leadId);

  await db.from("outreach_events").insert({
    lead_id: claimed.leadId,
    kind: "form_submitted",
    meta: { form_link_id: claimed.formLinkId, email: answers.email ?? null },
  });

  return ok({ received: true });
});
