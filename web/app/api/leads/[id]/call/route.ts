/**
 * api/leads/[id]/call/route.ts — Operator clicks "Call" on a lead.
 *
 * POST /api/leads/:id/call
 *   - Validates the lead exists + has a phone
 *   - Runs stage-5-call: generates a per-offer script + enqueues a
 *     call_attempt (manual provider → status 'queued'); sets call_status
 *   - Idempotent: an already-open attempt is returned instead of a new one
 *
 * Runs inline (Gemini + DB only, no filesystem build) — unlike /build it
 * doesn't need Cloud Run.
 */

import { getDb } from "@/lib/db";
import * as stage5call from "@/lib/pipeline/stage-5-call";
import type { Offer } from "@/lib/offers";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getLogger } from "@/lib/logger";
import { fail, ok } from "@/lib/response";

const log = getLogger("api.leads.call");

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  const db = getDb();
  const { data: lead, error } = await db
    .from("leads")
    .select(
      "id, business_name, phone, primary_offer, category, address, rating, review_count, demo_url, website_issues",
    )
    .eq("id", params.id)
    .single();

  if (error || !lead) return fail(`lead not found: ${params.id}`, 404);
  if (!lead.phone) return fail("Lead has no phone number to call.", 400);

  try {
    const result = await stage5call.run({
      id: lead.id,
      business_name: lead.business_name,
      phone: lead.phone,
      primary_offer: (lead.primary_offer as Offer | null) ?? null,
      category: lead.category,
      address: lead.address,
      rating: lead.rating,
      review_count: lead.review_count,
      demo_url: lead.demo_url,
      website_issues: (lead.website_issues as string[] | null) ?? [],
    });
    if (!result) return fail("Could not start a call (no phone).", 400);
    return ok(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ lead_id: lead.id, err: msg }, "call.failed");
    await db.from("leads").update({ last_error: msg }).eq("id", lead.id);
    return fail(`Call setup failed: ${msg}`, 502);
  }
});
