/**
 * api/webhooks/voice/route.ts — Voice-provider callback (STUB).
 *
 * POST /api/webhooks/voice
 *
 * When a live voice provider (Vapi/Retell/Bland/Twilio) is wired in, it will
 * POST call lifecycle events (ringing / answered / completed) + transcripts +
 * recordings here, to be reconciled onto call_attempts (matched by
 * provider_call_id in meta) and denormalized to leads.call_status.
 *
 * For now (manual provider) nothing calls this. It exists so the integration
 * surface is defined and the route is testable. It records the raw payload as
 * an outreach_events row for visibility and acknowledges with 200.
 */

import { getDb } from "@/lib/db";
import { withApi } from "@/lib/api-wrap";
import { isDbConfigured } from "@/lib/safe-db";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/response";

const log = getLogger("api.webhooks.voice");

export const POST = withApi(async (req) => {
  const payload = await req.json().catch(() => ({}));
  log.info({ keys: Object.keys(payload ?? {}) }, "webhook.voice.received");

  // Best-effort audit trail; never fail the webhook on a DB hiccup.
  if (isDbConfigured()) {
    try {
      const leadId =
        (payload as { lead_id?: string }).lead_id ??
        (payload as { metadata?: { lead_id?: string } }).metadata?.lead_id ??
        null;
      if (leadId) {
        await getDb()
          .from("outreach_events")
          .insert({ lead_id: leadId, kind: "voice_webhook", meta: payload });
      }
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, "webhook.voice.persist_failed");
    }
  }

  // TODO(voice-provider): match payload.call_id → call_attempts.meta, update
  // status/outcome/transcript/recording_url, and set leads.call_status.
  return ok({ received: true });
});
