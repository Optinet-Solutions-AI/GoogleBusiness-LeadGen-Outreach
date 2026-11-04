/**
 * api/leads/[id]/notes/route.ts — POST: append one CRM note to a lead.
 *
 * Inputs:  { body: string (1–4000), author?: string }
 * Outputs: { success, data: { id, created_at } }
 * Used by: components/crm/CrmLeadPanel.tsx
 *
 * Append-only (lead_notes, migration 054). The legacy leads.notes scratch field is untouched.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

const Body = z.object({
  body: z.string().trim().min(1).max(4000),
  author: z.string().trim().max(80).optional(),
});

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 422);

  const { data, error } = await getDb()
    .from("lead_notes")
    .insert({ lead_id: params.id, body: parsed.data.body, author: parsed.data.author || null })
    .select("id,created_at")
    .single();
  if (error) {
    if (/lead_notes/.test(error.message)) return fail("Notes need migration 054 (lead_notes table)", 503);
    return fail(error.message, 500);
  }
  return ok(data);
});
