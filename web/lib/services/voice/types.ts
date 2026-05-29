/**
 * voice/types.ts — Channel-agnostic voice-provider contract.
 *
 * Inputs:  (interface only — no I/O)
 * Outputs: VoiceProvider interface + call status/result shapes
 * Used by: lib/services/voice/manual.ts, voice/index.ts, lib/pipeline/stage-5-call.ts
 *
 * A VoiceProvider turns a generated call script + a phone number into an
 * outbound call attempt. The `manual` provider is a no-op queue (a human
 * dials and logs the outcome). A real provider (Vapi/Retell/Bland/Twilio)
 * implements the same interface and initiates an automated call — no
 * pipeline, route, or UI changes required to swap one in.
 */

import type { Offer } from "../../offers";
import type { CallScript } from "../call-script";

/** Mirrors call_attempts.status in db/schema.sql (migration 016). */
export type CallStatus =
  | "queued"
  | "dialing"
  | "connected"
  | "no_answer"
  | "voicemail"
  | "completed"
  | "failed";

export interface PlaceCallInput {
  call_attempt_id: string;
  lead_id: string;
  phone: string;
  offer: Offer;
  script: CallScript;
}

export interface PlaceCallResult {
  /** Provider name, stored on call_attempts.provider. */
  provider: string;
  /** Initial status — 'queued' for manual, 'dialing' for a live provider. */
  status: CallStatus;
  /** Provider's own call id, when the provider initiates a real call. */
  provider_call_id?: string | null;
  /** Anything provider-specific to persist on call_attempts.meta. */
  meta?: Record<string, unknown>;
}

export interface VoiceProvider {
  readonly name: string;
  /**
   * Begin an outbound call attempt. Must not throw for the normal "couldn't
   * connect" cases — return a result with status 'failed'/'no_answer' instead.
   */
  placeCall(input: PlaceCallInput): Promise<PlaceCallResult>;
}
