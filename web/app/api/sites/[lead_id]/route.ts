/**
 * api/sites/[lead_id]/route.ts — Demo-site URL + deploy status.
 *
 * GET /api/sites/:lead_id  → minimal projection used by the dashboard's
 * "Open demo" button + status pill.
 */

import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";

export async function GET(
  _req: Request,
  { params }: { params: { lead_id: string } },
) {
  const { data, error } = await getDb()
    .from("leads")
    .select("id,business_name,demo_url,stage,last_error")
    .eq("id", params.lead_id)
    .single();
  if (error || !data) return fail("not found", 404);
  return ok(data);
}
