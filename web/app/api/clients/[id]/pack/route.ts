/**
 * api/clients/[id]/pack/route.ts — GET: download a month's approved posts as a zip (PNGs + captions.csv).
 *
 * Inputs:  params.id; ?month=YYYY-MM (required)
 * Outputs: application/zip attachment "<client-slug>-<month>.zip"; fail() JSON on errors (404 when none approved)
 * Used by: Creative Studio ("Download pack")
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail } from "@/lib/response";
import { slugify } from "@/lib/slugify";
import { getClient } from "@/lib/clients/clients";
import { allUuids, mapCreativeError } from "@/lib/creatives/http-errors";
import { buildMonthPack } from "@/lib/creatives/pack";

const Query = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM") });

export const GET = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!allUuids(params.id)) return fail("client not found", 404);
  try {
    const { month } = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
    const client = await getClient(params.id);
    if (!client) return fail("client not found", 404);
    const zip = await buildMonthPack(params.id, month);
    if (!zip) return fail("no approved posts in that month", 404);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slugify(client.name)}-${month}.zip"`,
        "Content-Length": String(zip.length),
      },
    });
  } catch (e) {
    return mapCreativeError(e);
  }
});
