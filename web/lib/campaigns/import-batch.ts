/**
 * campaigns/import-batch.ts — Create the synthetic batch that holds imported leads.
 *
 * Inputs:  a SupabaseClient + a label (source/campaign name)
 * Outputs: the import batch id (leads.batch_id is NOT NULL, so imports need a batch)
 * Used by: app/api/leads/route.ts, app/api/leads/import/route.ts
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function ensureImportBatch(db: SupabaseClient, label: string): Promise<string> {
  const { data, error } = await db
    .from("batches")
    .insert({ niche: "import", city: label.slice(0, 80) || "manual", status: "done", scraped_count: 0 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ensureImportBatch.error: ${error?.message}`);
  return data.id as string;
}
