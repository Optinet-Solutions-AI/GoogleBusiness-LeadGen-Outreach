/**
 * voice/manual.ts — Manual (human-dialed) voice provider.
 *
 * Inputs:  PlaceCallInput
 * Outputs: PlaceCallResult { status: 'queued' }
 * Used by: lib/services/voice/index.ts (default provider)
 *
 * No external calling. The attempt lands in the dashboard call queue;
 * a human reads the generated script, dials the number, and logs the
 * outcome via POST /api/leads/:id/call/outcome. This is the day-1 mode
 * until a real voice provider is wired in.
 */

import { getLogger } from "../../logger";
import type { PlaceCallInput, PlaceCallResult, VoiceProvider } from "./types";

const log = getLogger("voice.manual");

export const manualProvider: VoiceProvider = {
  name: "manual",
  async placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
    log.info(
      { lead_id: input.lead_id, attempt: input.call_attempt_id, offer: input.offer },
      "voice.manual.queued",
    );
    return {
      provider: "manual",
      status: "queued",
      provider_call_id: null,
      meta: { mode: "manual", queued_for: "operator" },
    };
  },
};
