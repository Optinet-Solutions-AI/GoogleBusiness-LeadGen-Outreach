/**
 * voice/index.ts — Voice-provider factory (env-driven).
 *
 * Inputs:  env.VOICE_PROVIDER
 * Outputs: getVoiceProvider() → a VoiceProvider implementation
 * Used by: lib/pipeline/stage-5-call.ts
 *
 * Defaults to the manual (human-dialed) provider. Real providers
 * (Vapi/Retell/Bland/Twilio) implement the VoiceProvider interface in a
 * sibling file and get registered here. Selecting one is a config change
 * (VOICE_PROVIDER=vapi) — no pipeline/route/UI edits.
 */

import { env } from "../../config";
import type { VoiceProvider } from "./types";
import { manualProvider } from "./manual";

export type { VoiceProvider, PlaceCallInput, PlaceCallResult, CallStatus } from "./types";

export function getVoiceProvider(): VoiceProvider {
  switch (env.VOICE_PROVIDER) {
    case "manual":
      return manualProvider;
    // Live providers not yet implemented — fail loud so we don't silently
    // think calls are being placed when they aren't. Drop in a file that
    // implements VoiceProvider and wire it here when going live.
    case "vapi":
    case "retell":
    case "bland":
    case "twilio":
      throw new Error(
        `VOICE_PROVIDER='${env.VOICE_PROVIDER}' is not implemented yet — ` +
          `add lib/services/voice/${env.VOICE_PROVIDER}.ts and register it in voice/index.ts`,
      );
    default:
      return manualProvider;
  }
}
