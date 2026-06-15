/**
 * api/leads/[id]/route.ts — Inspect / hand-edit one lead.
 *
 * GET   /api/leads/:id   → full row
 * PATCH /api/leads/:id   body: { email?, brand_color?, stage?, notes?, primary_offer?,
 *                                call_segment?, offer_locked?, + photo/rebuild nulls }
 *   A call_segment pick derives the offer pair + needs_improvement and locks the
 *   lead (offer_locked); offer_locked:false hands routing back to the pipeline.
 */

import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { recordStageEvent } from "@/lib/lead-stage";
import { offersForSegment } from "@/lib/offers";

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

  const { error } = await getDb().from("leads").update(payload).eq("id", params.id);
  if (error) return fail(error.message, 500);
  if (typeof payload.stage === "string") await recordStageEvent(params.id, payload.stage);
  return ok({ id: params.id, updated: payload });
});
