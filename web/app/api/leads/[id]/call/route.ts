/**
 * api/leads/[id]/call/route.ts — "Call with AI" for one lead.
 *
 * Inputs:  POST, no body
 * Outputs: { queued, campaign_id, message } — 409 with the plain reason when the lead can't be called
 * Used by: components/leads/ContactCard.tsx, components/LeadsTable.tsx
 */
import { revalidateTag } from "next/cache";
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { queueQuickCall } from "@/lib/calls/quick-call";

export const dynamic = "force-dynamic";

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  try {
    const out = await queueQuickCall(params.id);
    if (!out.queued) return fail(out.message, 409);
    revalidateTag("campaigns");
    return ok(out);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (/not found/i.test(msg)) return fail("Lead not found", 404);
    return fail(`Couldn't queue the call: ${msg.slice(0, 160)}`, 502);
  }
});
