/**
 * api/batches/[id]/export/route.ts — Download a batch's phone-reachable leads as CSV.
 *
 * GET /api/batches/:id/export → text/csv (Content-Disposition: attachment).
 * Phone-reachable only (a voice dialer needs a number); one file per batch, for
 * hand-off to the standalone voice-agent app. Returns raw CSV, not the JSON
 * envelope — it's a file download.
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
      "business_name,phone,primary_offer,category,address,country_code,website_url,has_website,email,verification_status,rating,review_count,stage",
    )
    .eq("batch_id", params.id)
    .not("phone", "is", null)
    .neq("phone", "")
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
