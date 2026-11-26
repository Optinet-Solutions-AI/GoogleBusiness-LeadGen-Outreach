/**
 * api/brain/jobs/[id]/approve/route.ts — the operator approves a Brain plan (the ticked rows).
 *
 * Inputs:  POST params.id + { rows: [{ leadId, approved, channels: ("email"|"form"|"call")[], offer }] } (1–300 rows)
 * Outputs: { emails, forms, calls, days } — the email campaign is set up (first emails spread over the next days) and
 *          each lead has its day 0 and call day; 409 + plain reason when refused (already approved, nothing ticked,
 *          no mailbox…), in which case nothing is left running
 * Used by: components/brain/JobView.tsx
 *
 * Thin: zod → lib/brain/approve.ts. Nothing is sent in this request: the sequence tick sends the emails, the
 * automation tick the contact forms and calls.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { approvePlan } from "@/lib/brain/approve";
import { approveBody } from "@/lib/brain/request";

export const maxDuration = 60;

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = approveBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const r = await approvePlan(params.id, parsed.data.rows);
  if (!r.ok) return fail(r.message, 409);
  const { ok: _ok, ...data } = r;
  void _ok;
  return ok(data);
});
