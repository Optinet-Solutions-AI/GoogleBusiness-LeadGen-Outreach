/**
 * api/batches/[id]/export/route.ts — Download a batch's leads as CSV.
 *
 * Inputs:  GET /api/batches/:id/export
 * Outputs: text/csv (Content-Disposition: attachment): EVERY lead of the batch, qualified ones first; a lead the
 *          filters rejected says qualified = no. Raw CSV, not the JSON envelope (it's a file download).
 * Used by: the "Export CSV" button on the batch page
 *
 * Until 23 Nov 2026 this left out every lead without a phone number (it was built for a phone dialer), so a
 * Closures batch with 4 leads downloaded 1 row.
 */

import { getDb } from "@/lib/db";
import { fail } from "@/lib/response";
import { leadsToCsv, type ExportLead } from "@/lib/leads/export";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = getDb();

  const { data: batch } = await db
    .from("batches")
    .select("niche,city")
    .eq("id", params.id)
    .single();
  if (!batch) return fail("batch not found", 404);

  const { data, error } = await db
    .from("leads")
    .select(
      "business_name,phone,primary_offer,category,address,country_code,website_url,has_website,email,verification_status,rating,review_count,stage,qualified",
    )
    .eq("batch_id", params.id)
    .order("qualified", { ascending: false, nullsFirst: false })
    .order("business_name", { ascending: true });
  if (error) return fail("failed to load leads", 500);

  const csv = leadsToCsv((data ?? []) as ExportLead[]);
  const slug =
    `${batch.niche}-${batch.city}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    params.id;
  const filename = `leads-${slug}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
