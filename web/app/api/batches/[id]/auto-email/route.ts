/**
 * api/batches/[id]/auto-email/route.ts — cancel a batch's automatic email before it starts.
 *
 * Inputs:  POST params.id + { action: "cancel" }
 * Outputs: { cancelled: true } · 409 + a plain sentence when it isn't waiting any more
 * Used by: components/batches/AutoEmailBanner.tsx
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { fail, ok } from "@/lib/response";
import { cancelAutoEmail } from "@/lib/automation/auto-email";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.literal("cancel") });

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  if (!Body.safeParse(await req.json().catch(() => null)).success) return fail("Invalid body", 400);
  return (await cancelAutoEmail(params.id)) ? ok({ cancelled: true }) : fail("It isn't waiting any more (it already started, was skipped or was cancelled). Reload the page.", 409);
});
