/**
 * api/calls/[id]/recording/route.ts — a 1-hour signed link to one AI call's stored recording.
 *
 * Inputs:  GET, :id = call_attempts id, ?download=1 = link that downloads as "<business>-<date>.<ext>"
 * Outputs: { success, data: { url } } · 404 "No recording for this call yet."
 * Used by: components/calls/CallViewer.tsx (player + Download recording)
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { recordingLink } from "@/lib/calls/call-logs";
import { fail, ok } from "@/lib/response";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!z.string().uuid().safeParse(params.id).success) return fail("Not a call id", 422);
  const link = await recordingLink(params.id, new URL(req.url).searchParams.get("download") === "1");
  return link ? ok(link) : fail("No recording for this call yet.", 404);
});
