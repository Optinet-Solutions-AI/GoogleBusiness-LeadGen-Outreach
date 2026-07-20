/**
 * api/leads/[id]/route.ts — Inspect / hand-edit one lead.
 *
 * GET   /api/leads/:id   → full row
 * PATCH /api/leads/:id   body: { email?, brand_color?, stage?, notes?, primary_offer?,
 *                                call_segment?, offer_locked?, + photo/rebuild nulls }
 *   A call_segment pick derives the offer pair + needs_improvement and locks the
 *   lead (offer_locked); offer_locked:false hands routing back to the pipeline.
 *   Any manual segment/offer pick also stamps segment_reviewed_at (a human looked
 *   at this) — that stamp is never cleared by clearing the lock.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { recordStageEvent } from "@/lib/lead-stage";
import { offersForSegment } from "@/lib/offers";
import { getLogger } from "@/lib/logger";
import { isCloudRunConfigured, triggerJob } from "@/lib/services/cloud-run";
import * as stage2 from "@/lib/pipeline/stage-2-enrich";

const log = getLogger("api.leads.patch");

/**
 * Re-enrich a lead from its OLD website — crawl it for content images + logo +
 * brand color so a subsequent Build shows THEIR real imagery. Fired when an
 * operator flips a lead to `old_website` (Improve). Sets the shared
 * `rebuild_started_at` flag so the dashboard shows an in-progress spinner; the
 * server (Cloud Run runTracked / local finally) clears it on completion.
 * Best-effort — the caller must not fail the segment save if this throws.
 */
async function triggerReenrich(leadId: string, req: Request): Promise<void> {
  const db = getDb();
  await db
    .from("leads")
    .update({ rebuild_started_at: new Date().toISOString(), last_error: null })
    .eq("id", leadId);

  if (isCloudRunConfigured()) {
    const oidcToken =
      req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || null;
    try {
      await triggerJob({ MODE: "enrich", LEAD_ID: leadId }, { oidcToken });
    } catch (err) {
      await db.from("leads").update({ rebuild_started_at: null }).eq("id", leadId);
      throw err;
    }
    return;
  }

  // Local-dev fallback: in-process enrich (fetch-only — no Chromium locally, but
  // extractWebsiteImages is plain fetch so old-site images still land).
  const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single();
  if (!lead) {
    await db.from("leads").update({ rebuild_started_at: null }).eq("id", leadId);
    return;
  }
  stage2
    .run(lead)
    .catch((err) => log.error({ lead_id: leadId, err: String(err) }, "reenrich.failed"))
    .finally(async () => {
      await db.from("leads").update({ rebuild_started_at: null }).eq("id", leadId);
    });
}

export const GET = withApi(async (_req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const { data, error } = await getDb()
    .from("leads")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error || !data) return fail("not found", 404);
  return ok(data);
});

const PatchBody = z.object({
  email: z.string().email().nullable().optional(),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  stage: z.string().optional(),
  notes: z.string().max(4000).optional(),
  // Operator override of the auto-routed offer. Setting it locks the offer so
  // the pipeline's router (stage 1/2) won't re-stomp it on a rebuild.
  primary_offer: z.enum(["build_website", "improve_website", "voice_agent"]).optional(),
  // Operator override of the auto-routed SEGMENT. Derives the offer pair +
  // needs_improvement and locks the lead so the pipeline won't re-route it.
  call_segment: z.enum(["no_website", "old_website", "has_website"]).optional(),
  // Clear (false) hands routing back to the pipeline. Setting call_segment /
  // primary_offer forces this true regardless of what's sent here.
  offer_locked: z.boolean().optional(),
  // Only `null` is accepted — clients can clear the in-progress flag once
  // their polling loop confirms the rebuild finished. They cannot SET it
  // from the client (only the regenerate API does that).
  rebuild_started_at: z.null().optional(),
  // Photo-selector cache columns. Only `null` is accepted from clients —
  // setting an actual URL is reserved for stage-3-generate. Allowing nulls
  // here lets /build?refresh-photos=1 clear the cache before dispatch.
  hero_photo_url: z.null().optional(),
  photo_order_json: z.null().optional(),
  photos_picked_at: z.null().optional(),
});

export const PATCH = withApi(async (req, { params }) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);

  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) return fail(parsed.error.message, 422);

  const payload: Record<string, unknown> = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(payload).length === 0) return fail("no fields to update", 400);

  // A manual SEGMENT pick derives the offer pair + needs_improvement, and locks.
  if (typeof payload.call_segment === "string") {
    const segment = payload.call_segment as "no_website" | "old_website" | "has_website";
    const { primary_offer, secondary_offer } = offersForSegment(segment);
    payload.primary_offer = primary_offer;
    payload.secondary_offer = secondary_offer;
    if (segment === "old_website") payload.needs_improvement = true;
    else if (segment === "has_website") payload.needs_improvement = false;
    payload.offer_locked = true;
  }
  // A manual offer pick is also an override — lock it.
  if ("primary_offer" in payload && payload.call_segment === undefined) payload.offer_locked = true;
  // Any manual segment/offer pick = a human reviewed this lead. Stamp it (never
  // cleared by clearing the lock) so the dashboard can show a "reviewed" badge
  // regardless of whether the lead is currently locked. A bare offer_locked:false
  // (the "clear lock" action) deliberately leaves this stamp intact.
  if ("call_segment" in payload || "primary_offer" in payload) {
    payload.segment_reviewed_at = new Date().toISOString();
  }

  const { error } = await getDb().from("leads").update(payload).eq("id", params.id);
  if (error) return fail(error.message, 500);
  if (typeof payload.stage === "string") await recordStageEvent(params.id, payload.stage);

  // Flip to old_website (Improve) → re-enrich from the old site (images + logo +
  // color). Best-effort: never fail the segment save if the trigger errors.
  let reenriching = false;
  if (payload.call_segment === "old_website") {
    try {
      await triggerReenrich(params.id, req);
      reenriching = true;
    } catch (err) {
      log.warn({ lead_id: params.id, err: String(err) }, "reenrich.trigger_failed");
    }
  }
  return ok({ id: params.id, updated: payload, reenriching });
});
