/**
 * api/leads/[id]/client/route.ts — POST: make (or fetch) the client for a lead.
 *
 * Inputs:  params.id (lead UUID)
 * Outputs: { client_id, created } — idempotent on clients.lead_id
 * Used by: "Make client" action on the lead view
 */
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { createClientFromLead } from "@/lib/clients/clients";

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  try {
    const { client, created } = await createClientFromLead(params.id);
    return ok({ client_id: client.id, created });
  } catch (err) {
    if (err instanceof Error && err.message === "lead not found") return fail("lead not found", 404);
    throw err;
  }
});
