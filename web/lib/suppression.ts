/**
 * suppression.ts — single source of truth for "don't contact this number".
 *
 * Inputs:  a lead ({ phone, lifecycle_stage }) + a channel
 * Outputs: isSuppressed() boolean; addSuppression() writes a permanent block
 * Used by: stage-6-sms (gate SMS), the SMS STOP handler, and (later) the pre-call guard
 *
 * A number is suppressed if the lead is dnc/unsubscribed OR a phone-keyed `suppressions` row exists.
 * Phone-keyed so a STOP survives lead deletion and applies across batches. Server-only (touches DB).
 */

import "server-only";
import { getDb } from "./db";
import { getLogger } from "./logger";

const log = getLogger("suppression");

export type SuppressChannel = "voice" | "sms";

/**
 * Normalize a phone to a stable match key. US MVP: last 10 digits, so "+1 (555) 123-4567",
 * "15551234567" and "555-123-4567" all collapse to the same key. (Revisit for multi-country.)
 */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-10);
}

export async function isSuppressed(
  lead: { phone?: string | null; lifecycle_stage?: string | null },
  channel: SuppressChannel,
): Promise<boolean> {
  if (lead.lifecycle_stage === "dnc" || lead.lifecycle_stage === "unsubscribed") return true;

  const phone = normalizePhone(lead.phone);
  if (!phone) return false;

  const { data, error } = await getDb()
    .from("suppressions")
    .select("id")
    .eq("phone_e164", phone)
    .in("channel", ["all", channel])
    .limit(1);

  if (error) {
    // Most likely the table doesn't exist yet (pre-migration). Fail open so the $0 journey still
    // runs — the lifecycle_stage check above already blocks dnc/unsubscribed without the table.
    log.warn({ err: error.message }, "suppression.isSuppressed.query_failed (open)");
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export async function addSuppression(input: {
  leadId?: string | null;
  phone: string;
  channel?: "voice" | "sms" | "all";
  reason?: string;
}): Promise<void> {
  const phone = normalizePhone(input.phone);
  if (!phone) return;
  const channel = input.channel ?? "all";

  const { error } = await getDb()
    .from("suppressions")
    .upsert(
      { lead_id: input.leadId ?? null, phone_e164: phone, channel, reason: input.reason ?? null },
      { onConflict: "phone_e164,channel", ignoreDuplicates: true },
    );

  if (error) log.warn({ err: error.message }, "suppression.addSuppression.failed");
  else log.info({ phone, channel }, "suppression.added");
}
