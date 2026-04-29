/**
 * api/leads/[id]/meeting/route.ts — Track sales-meeting state on a lead.
 *
 * POST /api/leads/:id/meeting  body: { status: 'booked'|'done', notes? }
 *   - 'booked' → lead.stage = 'meeting_booked'
 *   - 'done'   → lead.stage = 'meeting_done'
 *   - notes are appended to lead.notes (preserves prior)
 *
 * Operator action only — no external calls, no cost.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

const Body = z.object({
  status: z.enum(["booked", "done"]),
  notes: z.string().max(2000).optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  const db = getDb();
  const { data: lead, error } = await db
    .from("leads")
    .select("notes")
    .eq("id", params.id)
    .single();
  if (error || !lead) return fail("lead not found", 404);

  const stage = parsed.data.status === "booked" ? "meeting_booked" : "meeting_done";
  const stamp = new Date().toISOString();
  const newNotes = parsed.data.notes
    ? [lead.notes, `[${stamp}] (${stage}) ${parsed.data.notes}`].filter(Boolean).join("\n")
    : lead.notes;

  const { error: upErr } = await db
    .from("leads")
    .update({ stage, notes: newNotes })
    .eq("id", params.id);
  if (upErr) return fail(upErr.message, 500);

  return ok({ id: params.id, stage });
});
