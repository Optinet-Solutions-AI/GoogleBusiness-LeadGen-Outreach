/**
 * save-lead.ts — update one lead, tolerating a database without migration 069 (the AI website check's columns).
 *
 * Inputs:  a Supabase client, lead id, the patch
 * Outputs: { error } — the same as a plain update; when 069 is missing, saved again without website_review /
 *          website_reviewed_at instead of failing
 * Used by: app/api/leads/[id]/route.ts (PATCH: a hand-typed website), lib/leads/research-decide.ts (Verify a website)
 *
 * Both clear the old site's AI check when the website changes; before 069 there is nothing to clear.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumn } from "@/lib/db-errors";

const REVIEW_COLS = ["website_review", "website_reviewed_at"];

export async function updateLead(
  db: SupabaseClient,
  leadId: string,
  patch: Record<string, unknown>,
): Promise<{ error: { message: string; code?: string } | null }> {
  const first = await db.from("leads").update(patch).eq("id", leadId);
  if (!first.error || !REVIEW_COLS.some((c) => c in patch) || !isMissingColumn(first.error, "website_review")) {
    return { error: first.error };
  }
  const rest = { ...patch };
  for (const c of REVIEW_COLS) delete rest[c];
  const second = await db.from("leads").update(rest).eq("id", leadId);
  return { error: second.error };
}
