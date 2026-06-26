/**
 * api/inbox/actions/route.ts — bulk inbox triage actions (also used for one).
 *
 * Inputs:  POST { lead_ids: string[], read?, is_favorite?, archive?, dnc? }
 * Outputs: { updated: number } — applies the patch to every lead_id
 * Used by: the Gmail-style inbox (row actions + bulk toolbar)
 *
 * read       → inbox_read_at = now | null (unread = null, bold in the list)
 * is_favorite→ star toggle
 * archive    → inbox_status 'closed' | 'open'
 * dnc:true   → lifecycle_stage='dnc' + inbox_status='closed' + stop the sequence
 *              (suppresses all future sends; isSuppressed() honors 'dnc')
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { stopSequence } from "@/lib/pipeline/sequence-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(1000),
  read: z.boolean().optional(),
  is_favorite: z.boolean().optional(),
  archive: z.boolean().optional(),
  dnc: z.boolean().optional(),
  // Snooze: hide until snooze_until, then re-surface. unsnooze brings it back now.
  snooze_until: z.string().datetime().optional(),
  unsnooze: z.boolean().optional(),
  // Labels: add/remove a free-form tag on each thread.
  add_label: z.string().min(1).max(40).optional(),
  remove_label: z.string().min(1).max(40).optional(),
});

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);
  const b = parsed.data;

  const db = getDb();

  // Label add/remove is a per-lead array read-modify-write (Postgres array ops
  // aren't expressible in a single Supabase update). Handle it first, separately.
  if (b.add_label || b.remove_label) {
    const { data: rows } = await db
      .from("leads")
      .select("id,inbox_labels")
      .in("id", b.lead_ids);
    await Promise.all(
      ((rows ?? []) as { id: string; inbox_labels: string[] | null }[]).map((r) => {
        const set = new Set(r.inbox_labels ?? []);
        if (b.add_label) set.add(b.add_label);
        if (b.remove_label) set.delete(b.remove_label);
        return db.from("leads").update({ inbox_labels: [...set] }).eq("id", r.id);
      }),
    );
    return ok({ updated: rows?.length ?? 0 });
  }

  const patch: Record<string, unknown> = {};
  if (b.read !== undefined) patch.inbox_read_at = b.read ? new Date().toISOString() : null;
  if (b.is_favorite !== undefined) patch.is_favorite = b.is_favorite;
  if (b.archive !== undefined) patch.inbox_status = b.archive ? "closed" : "open";
  if (b.snooze_until) {
    patch.inbox_status = "snoozed";
    patch.inbox_snooze_until = b.snooze_until;
  }
  if (b.unsnooze) {
    patch.inbox_status = "open";
    patch.inbox_snooze_until = null;
  }
  if (b.dnc) {
    patch.lifecycle_stage = "dnc";
    patch.inbox_status = "closed";
  }

  if (Object.keys(patch).length === 0) return fail("No action specified", 400);

  const { error, count } = await db
    .from("leads")
    .update(patch, { count: "exact" })
    .in("id", b.lead_ids);
  if (error) return fail(error.message, 502);

  // DNC must also halt any in-flight sequence so we never follow up.
  if (b.dnc) {
    await Promise.all(b.lead_ids.map((id) => stopSequence(id, "marked_dnc").catch(() => {})));
  }

  return ok({ updated: count ?? b.lead_ids.length });
});
