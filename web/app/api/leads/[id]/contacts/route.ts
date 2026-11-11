/**
 * api/leads/[id]/contacts/route.ts — "Find contacts (AI)" for one lead.
 *
 * Inputs:  POST, no body
 * Outputs: { email, phone, contact_owner_name, contact_owner_role, contact_page_url, contact_sources, found, ai_state,
 *            message } — message is the plain-English result for the toast
 * Used by: components/leads/ContactCard.tsx, components/LeadsTable.tsx (one call per selected lead)
 *
 * Paid: about 1–3 cents when OpenAI runs. Takes 10–40 s (web search + a crawl of their site).
 */
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { describeOutcome, researchLeadContacts } from "@/lib/leads/research-contact";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!params.id) return fail("Missing lead id", 400);
  try {
    const out = await researchLeadContacts(params.id);
    return ok({ ...out, message: describeOutcome(out) });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (/not found/i.test(msg)) return fail("Lead not found", 404);
    return fail(`Couldn't research this lead: ${msg.slice(0, 160)}`, 502);
  }
});
