/**
 * api/leads/[id]/dm/route.ts — POST: log that the operator sent a manual DM.
 *
 * Inputs:  params.id + body { message?: string }
 * Outputs: { logged: true, stage } | fail(reason)
 * Used by: components/AssistedDmPanel.tsx "Mark DM sent".
 *
 * DMs are sent by hand (Meta blocks automated cold DMs), so this just records the
 * action: an outreach_events row (kind 'dm_sent') and, if the lead is still
 * pre-outreach, advances stage → 'outreached'. No external/paid call.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const Body = z.object({ message: z.string().max(2000).optional() });

// Stages before outreach — advancing from any of these to 'outreached' is safe.
const PRE_OUTREACH = ["scraped", "enriched", "generated", "deployed", "needs_email"];

export const POST = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Invalid body", 400);

  const db = getDb();
  const { data: lead } = await db.from("leads").select("id,stage").eq("id", params.id).maybeSingle();
  if (!lead) return fail("Lead not found", 404);

  await db.from("outreach_events").insert({
    lead_id: lead.id,
    kind: "dm_sent",
    meta: { via: "manual", message: parsed.data.message ?? null },
  });

  let stage = lead.stage as string;
  if (PRE_OUTREACH.includes(stage)) {
    stage = "outreached";
    await db.from("leads").update({ stage }).eq("id", lead.id);
  }

  return ok({ logged: true, stage });
});
