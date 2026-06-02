/**
 * elevenlabs.ts — ElevenLabs voice library client (server-only).
 *
 * Inputs:  env.ELEVENLABS_API_KEY
 * Outputs: list of { provider, voiceId, label } for the voice picker
 * Used by: lib/services/voice/vapi-admin.ts (listVoices fallback source)
 */

import "server-only";

import { env } from "@/lib/config";
import { retry } from "@/lib/retry";
import { getLogger } from "@/lib/logger";

const log = getLogger("elevenlabs");
const BASE_URL = "https://api.elevenlabs.io/v1";

interface ElevenLabsVoiceRaw {
  voice_id: string;
  name?: string | null;
  category?: string | null;
}

interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoiceRaw[];
}

export async function listElevenLabsVoices(): Promise<
  { provider: string; voiceId: string; label: string }[]
> {
  if (!env.ELEVENLABS_API_KEY) {
    log.info({}, "elevenlabs.listVoices.skip (no api key)");
    return [];
  }

  try {
    const resp = await retry(
      () =>
        fetch(`${BASE_URL}/voices`, {
          method: "GET",
          headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
        }),
      { maxAttempts: 3 },
    );

    if (!resp.ok) {
      log.warn(
        { status: resp.status },
        "elevenlabs.listVoices.error — falling back to empty list",
      );
      return [];
    }

    const data = (await resp.json()) as ElevenLabsVoicesResponse;
    const voices = Array.isArray(data.voices) ? data.voices : [];

    const result = voices.map((v) => ({
      provider: "11labs",
      voiceId: v.voice_id,
      label: v.name || v.voice_id,
    }));

    log.info({ count: result.length }, "elevenlabs.listVoices.ok");
    return result;
  } catch (e) {
    log.warn({ err: e }, "elevenlabs.listVoices.exception — falling back to empty list");
    return [];
  }
}
