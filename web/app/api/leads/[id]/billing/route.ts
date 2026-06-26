/**
 * api/leads/[id]/billing/route.ts — record per-deal billing on a lead.
 *
 * POST { setup_fee?, monthly_amount?, billing_status?, billing_notes? }
 *   Record-only (no live charge yet). Stores the agreed setup fee + monthly
 *   hosting price and the billing status; stamps billing_updated_at.
 * Used by: the Billing card on the lead detail page.
 *
 * billing_status: invoiced | active | past_due | canceled | "" (clears it).
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  setup_fee: z.number().min(0).max(1_000_000).nullable().optional(),
  monthly_amount: z.number().min(0).max(1_000_000).nullable().optional(),
  billing_status: z.enum(["invoiced", "active", "past_due", "canceled", ""]).optional(),
  billing_notes: z.string().max(2000).nullable().optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid billing input", 400);
  const b = parsed.data;

  const patch: Record<string, unknown> = { billing_updated_at: new Date().toISOString() };
  if (b.setup_fee !== undefined) patch.setup_fee = b.setup_fee;
  if (b.monthly_amount !== undefined) patch.monthly_amount = b.monthly_amount;
  if (b.billing_status !== undefined) patch.billing_status = b.billing_status || null;
  if (b.billing_notes !== undefined) patch.billing_notes = b.billing_notes || null;

  const { data, error } = await getDb()
    .from("leads")
    .update(patch)
    .eq("id", params.id)
    .select("id,setup_fee,monthly_amount,billing_status,billing_notes,billing_updated_at")
    .single();
  if (error || !data) return fail(error?.message ?? "Lead not found", error ? 502 : 404);
  return ok(data);
});
