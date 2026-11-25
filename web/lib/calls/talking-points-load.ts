/**
 * calls/talking-points-load.ts — loads what the talking points need: the lead's last email and the agent's offer.
 *
 * Inputs:  lead id (email_messages newest outbound sent email; outreach_events meta.email_used for which email it was;
 *          email_templates.service_key for a saved one); a Voizo campaign id (GET /api/v1/scripts, free, cached)
 * Outputs: talkingPointsFor() → TalkingPoints | null; offerOfVoizoCampaign() → the offer that agent pitches | null
 * Used by: lib/pipeline/call-scheduler.ts (real calls), lib/calls/voice-test-start.ts (browser test calls)
 *
 * Never stops a call: any lookup that fails means no talking points (the call goes as before), logged.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { getTemplate } from "@/lib/email/template-library";
import { listScripts } from "@/lib/services/voizo";
import { pickTalkingPoints, templateLeadOf, type LastEmail, type TalkingLead, type TalkingPoints } from "./talking-points";

const log = getLogger("talking-points");

/** The newest email we sent the lead, and which email it was; null = none sent. */
export async function lastEmailFor(leadId: string): Promise<LastEmail | null> {
  const db = getDb();
  const { data, error } = await db
    .from("email_messages")
    .select("subject,body_text,message_id")
    .eq("lead_id", leadId)
    .eq("direction", "outbound")
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const msg = data as { subject: string | null; body_text: string | null; message_id: string | null } | null;
  if (!msg?.body_text) return null;
  let usedKey: string | null = null;
  if (msg.message_id) {
    const ev = await db
      .from("outreach_events")
      .select("meta")
      .eq("lead_id", leadId)
      .eq("kind", "email_sent")
      .eq("meta->>message_id", msg.message_id)
      .limit(1)
      .maybeSingle();
    const used = (ev.data as { meta: { email_used?: { key?: unknown } } | null } | null)?.meta?.email_used?.key;
    usedKey = typeof used === "string" ? used : null;
  }
  const templateOffer = usedKey?.startsWith("saved:")
    ? ((await getTemplate(usedKey.slice("saved:".length)).catch(() => null))?.service_key ?? null)
    : null;
  return { subject: msg.subject ?? "", body: msg.body_text, usedKey, templateOffer };
}

/** The talking points for a call with this offer; null when there are none or a lookup failed. */
export async function talkingPointsFor(leadId: string, offer: string | null, lead: TalkingLead, city?: string | null): Promise<TalkingPoints | null> {
  try {
    const last = await lastEmailFor(leadId);
    return pickTalkingPoints(offer, last, templateLeadOf(lead, city));
  } catch (err) {
    log.warn({ lead_id: leadId, err: String(err) }, "talking_points.load_failed");
    return null;
  }
}

/** Voizo's `variables` addition: { talkingPoints } or nothing. */
export function talkingPointsVar(tp: TalkingPoints | null): { talkingPoints?: string } {
  return tp?.text ? { talkingPoints: tp.text } : {};
}

let scriptCache: { at: number; byCampaign: Map<string, string> } | null = null;
const SCRIPT_CACHE_MS = 10 * 60_000;

/** The offer a Voizo agent (campaign) pitches, from its script name; unknown / Voizo unreachable → null. */
export async function offerOfVoizoCampaign(campaignId: string | null): Promise<string | null> {
  if (!campaignId) return null;
  if (!scriptCache || Date.now() - scriptCache.at > SCRIPT_CACHE_MS) {
    const r = await listScripts().catch(() => null);
    if (!r?.ok) return null;
    scriptCache = { at: Date.now(), byCampaign: new Map(r.data.scripts.filter((s) => s.offerKey).map((s) => [s.campaignId, s.offerKey!])) };
  }
  return scriptCache.byCampaign.get(campaignId) ?? null;
}
