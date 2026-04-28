/**
 * api/webhooks/instantly/route.ts — Inbound Instantly events (opens, replies, bounces).
 *
 * POST /api/webhooks/instantly
 *   - Records every event into outreach_events.
 *   - On reply, advances the matching lead to stage='replied'.
 */

import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/response";

const log = getLogger("webhook.instantly");

const KIND_MAP: Record<string, string> = {
  email_opened: "email_opened",
  email_replied: "replied",
  reply_received: "replied",
  email_bounced: "email_bounced",
};

export async function POST(req: Request) {
  const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const eventKind = (payload.event as string) ?? (payload.type as string) ?? "unknown";
  const lead = payload.lead as { email?: string } | undefined;
  const email = lead?.email ?? (payload.email as string | undefined);

  log.info({ event: eventKind, email }, "received");

  if (email) {
    const db = getDb();
    const { data: rows } = await db.from("leads").select("id").eq("email", email).limit(1);
    const leadRow = rows?.[0];
    if (leadRow) {
      await db.from("outreach_events").insert({
        lead_id: leadRow.id,
        kind: KIND_MAP[eventKind] ?? eventKind,
        meta: payload,
      });
      if (eventKind === "email_replied" || eventKind === "reply_received") {
        await db.from("leads").update({ stage: "replied" }).eq("id", leadRow.id);
      }
    }
  }

  return ok({ received: true });
}
