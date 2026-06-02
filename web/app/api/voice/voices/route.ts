/**
 * app/api/voice/voices/route.ts — List voices in use across all Vapi assistants.
 *
 * Inputs:  none (read-only)
 * Outputs: { voices: VoiceOption[] }
 * Used by: components/AgentEditor.tsx (voice picker)
 *
 * Returns an empty list (not an error) when Vapi is not configured so the
 * editor can still render a manual voice entry.
 */

import { withApi } from "@/lib/api-wrap";
import { ok } from "@/lib/response";
import { isVapiConfigured, listVoices } from "@/lib/services/voice/vapi-admin";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  if (!isVapiConfigured()) {
    return ok({ voices: [] });
  }
  const voices = await listVoices();
  return ok({ voices });
});
