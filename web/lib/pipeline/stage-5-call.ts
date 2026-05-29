/**
 * stage-5-call.ts — Voice outreach: generate a script + enqueue a call attempt.
 *
 * Inputs:  lead row at stage='deployed' (or any built lead with a phone)
 * Outputs: a `call_attempts` row + leads.call_status + an outreach_events row
 * Used by: app/api/leads/[id]/call/route.ts (operator "Call" action)
 *
 * Replaces the deprecated email stage (stage-5-outreach.ts). A human (or a
 * future voice agent via the VoiceProvider interface) works the resulting
 * call queue: reads the generated script, dials, logs the outcome.
 *
 * Idempotent: only ONE open attempt (status 'queued'/'dialing') per lead at a
 * time. Re-running returns the existing open attempt instead of stacking
 * duplicates.
 *
 * Cost: Gemini script generation is free-tier (~$0). The manual provider
 * places no real call. A paid voice provider adds per-minute cost later.
 */

import { getDb } from "../db";
import { getLogger } from "../logger";
import type { Offer } from "../offers";
import { generateCallScript, renderScriptText } from "../services/call-script";
import { getVoiceProvider } from "../services/voice";

const log = getLogger("stage-5-call");

export interface Lead {
  id: string;
  business_name: string;
  phone: string | null;
  primary_offer: Offer | null;
  category?: string | null;
  address?: string | null;
  rating?: number | null;
  review_count?: number | null;
  demo_url?: string | null;
  website_issues?: string[] | null;
}

export interface CallResult {
  call_attempt_id: string;
  status: string;
  offer: Offer;
  /** true when an existing open attempt was returned instead of a new one. */
  reused: boolean;
}

const OPEN_STATUSES = ["queued", "dialing"] as const;

export async function run(lead: Lead): Promise<CallResult | null> {
  const db = getDb();

  if (!lead.phone) {
    log.warn({ lead_id: lead.id }, "stage_5_call.skip_no_phone");
    return null;
  }

  // Idempotency: reuse an already-open attempt for this lead.
  const { data: existing } = await db
    .from("call_attempts")
    .select("id, status, offer_pitched")
    .eq("lead_id", lead.id)
    .in("status", OPEN_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    log.info({ lead_id: lead.id, attempt: existing.id }, "stage_5_call.reuse_open");
    return {
      call_attempt_id: existing.id,
      status: existing.status,
      offer: (existing.offer_pitched as Offer) ?? "voice_agent",
      reused: true,
    };
  }

  const offer: Offer = lead.primary_offer ?? "voice_agent";

  // Generate the phone script (Gemini, free tier).
  const script = await generateCallScript(
    {
      business_name: lead.business_name,
      category: lead.category ?? null,
      address: lead.address ?? null,
      rating: lead.rating ?? null,
      review_count: lead.review_count ?? null,
      demo_url: lead.demo_url ?? null,
      website_issues: lead.website_issues ?? [],
    },
    offer,
  );
  const scriptText = renderScriptText(script);

  // Create the attempt row first so the provider has an id to reference.
  const { data: inserted, error: insErr } = await db
    .from("call_attempts")
    .insert({
      lead_id: lead.id,
      offer_pitched: offer,
      provider: getVoiceProvider().name,
      status: "queued",
      script_snapshot: scriptText,
    })
    .select("id")
    .single();
  if (insErr || !inserted) throw new Error(`stage_5_call.insert.error: ${insErr?.message}`);
  const attemptId = inserted.id as string;

  // Hand off to the provider. Manual = no real call, returns status 'queued'.
  const provider = getVoiceProvider();
  const placed = await provider.placeCall({
    call_attempt_id: attemptId,
    lead_id: lead.id,
    phone: lead.phone,
    offer,
    script,
  });

  await db
    .from("call_attempts")
    .update({
      provider: placed.provider,
      status: placed.status,
      meta: placed.meta ?? {},
      ...(placed.provider_call_id ? { recording_url: null } : {}),
    })
    .eq("id", attemptId);

  // Denormalize latest call state onto the lead for the dashboard queue.
  await db.from("leads").update({ call_status: placed.status }).eq("id", lead.id);

  // Unified timeline event (mirrors the email-era outreach_events rows).
  await db.from("outreach_events").insert({
    lead_id: lead.id,
    kind: "call_placed",
    meta: { offer, provider: placed.provider, status: placed.status, attempt_id: attemptId },
  });

  log.info(
    { lead_id: lead.id, attempt: attemptId, offer, status: placed.status, provider: placed.provider },
    "stage_5_call.done",
  );
  return { call_attempt_id: attemptId, status: placed.status, offer, reused: false };
}
