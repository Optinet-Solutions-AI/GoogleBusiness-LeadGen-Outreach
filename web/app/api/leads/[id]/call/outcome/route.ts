/**
 * api/leads/[id]/call/outcome/route.ts — Log the result of a call.
 *
 * POST /api/leads/:id/call/outcome
 *   body: {
 *     outcome?: 'interested'|'not_interested'|'callback'|'wrong_number'|'do_not_call',
 *     status?:  'no_answer'|'voicemail'|'completed',   // when there's no talk outcome
 *     duration_sec?: number,
 *     notes?: string,
 *     attempt_id?: string,    // defaults to the lead's latest attempt
 *   }
 *
 * Updates the call_attempts row, denormalizes leads.call_status, writes an
 * outreach_events row, and — for do_not_call — flips lifecycle_stage to 'dnc'.
 * At least one of `outcome` / `status` is required.
 */

import { z } from "zod";
import { getDb } from "@/lib/db";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";

const log = getLogger("api.leads.outcome");

const Body = z
  .object({
    outcome: z
      .enum(["interested", "not_interested", "callback", "wrong_number", "do_not_call"])
      .optional(),
    status: z.enum(["no_answer", "voicemail", "completed"]).optional(),
    duration_sec: z.number().int().min(0).max(36_000).optional(),
    notes: z.string().max(4000).optional(),
    attempt_id: z.string().uuid().optional(),
  })
  .refine((b) => b.outcome || b.status, {
    message: "provide an outcome or a status",
  });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);
  const { outcome, status, duration_sec, notes, attempt_id } = parsed.data;

  const db = getDb();

  // Resolve which attempt we're logging against — the named one, else latest.
  let targetId = attempt_id ?? null;
  if (!targetId) {
    const { data: latest } = await db
      .from("call_attempts")
      .select("id")
      .eq("lead_id", params.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    targetId = latest?.id ?? null;
  }
  if (!targetId) return fail("no call attempt to log against — start a call first", 404);

  // call_attempts.status: any talk outcome means the call completed; otherwise
  // use the supplied no_answer/voicemail/completed disposition.
  const attemptStatus = outcome ? "completed" : status!;
  // leads.call_status mirrors the disposition; do_not_call surfaces as 'dnc'.
  const callStatus = outcome === "do_not_call" ? "dnc" : status ?? "completed";

  const { error: updErr } = await db
    .from("call_attempts")
    .update({
      status: attemptStatus,
      ...(outcome ? { outcome } : {}),
      ...(duration_sec != null ? { duration_sec } : {}),
      ended_at: new Date().toISOString(),
    })
    .eq("id", targetId);
  if (updErr) return fail(updErr.message, 500);

  // Denormalize onto the lead; do_not_call also suppresses future outreach.
  const leadUpdate: Record<string, unknown> = { call_status: callStatus };
  if (outcome === "do_not_call") leadUpdate.lifecycle_stage = "dnc";
  if (notes) leadUpdate.notes = notes;
  await db.from("leads").update(leadUpdate).eq("id", params.id);

  await db.from("outreach_events").insert({
    lead_id: params.id,
    kind: outcome === "do_not_call" ? "call_dnc" : `call_${status ?? "completed"}`,
    meta: { attempt_id: targetId, outcome: outcome ?? null, duration_sec: duration_sec ?? null },
  });

  // Best-effort: reflect outcome onto any campaign_leads rows for this lead.
  const campaignStatus =
    outcome === "interested" ? "interested"
    : outcome === "not_interested" || outcome === "wrong_number" ? "done"
    : outcome === "do_not_call" ? "skipped"
    : "called";
  const { error: clErr } = await db
    .from("campaign_leads")
    .update({ status: campaignStatus })
    .eq("lead_id", params.id);
  if (clErr) log.warn({ lead_id: params.id, err: clErr.message.slice(0, 200) }, "campaign_leads.update_failed");

  return ok({ id: params.id, attempt_id: targetId, call_status: callStatus, outcome: outcome ?? null });
});
