/**
 * calls/load-call-preview.ts — what the AI agent will (and will not) know before "Call with AI" queues a lead.
 *
 * Inputs:  lead id; the lead row, Voizo GET /status (free, places no call), the call queue
 * Outputs: CallPreview — the number it dials, the name it greets by, the script it follows, the hours, the queue,
 *          the retry rule, and what it does NOT know. Never throws on a Voizo problem (it is reported instead).
 * Used by: app/api/leads/[id]/call/preview/route.ts
 *
 * Voizo's Dial API takes only a phone number and a first name. Everything else the agent says comes from ONE
 * fixed script on the Voizo campaign, the same for every lead. The preview says so plainly, so nobody expects
 * the agent to mention the business, the demo site or the offer.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { env } from "@/lib/config";
import { campaignTimezone } from "@/lib/call-hours";
import { toE164 } from "@/lib/phone";
import { callBlock } from "@/lib/leads/contact-readiness";
import { getStatus, isVoizoConfigured } from "@/lib/services/voizo";
import { suggestGreetingName } from "@/lib/calls/greeting-name";
import { isMissingColumn } from "@/lib/db-errors";
import { windowText } from "@/lib/outreach/when-text";

export interface CallPreview {
  leadId: string;
  businessName: string;
  canCall: boolean;
  block: string | null;
  /** No phone on file: the call can still go to a number typed in the preview (a test). */
  needsNumber: boolean;
  /** The number exactly as it will be dialled (E.164), or the raw number when it can't be formatted. */
  phone: string | null;
  ownerName: string | null;
  /** Pre-filled greeting: the name already saved for a queued call, else the owner's first name. */
  greetingName: string | null;
  alreadyQueued: boolean;
  script: { campaignName: string | null; shadow: boolean | null };
  voizo: { configured: boolean; ready: boolean | null; remainingToday: number | null; dailyCap: number | null; windows: string | null; error: string | null };
  ourHours: string;
  queueAhead: number;
  attempts: { max: number; retryHours: number };
}

const DAY_ISO: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

function voizoWindowsText(w: { day: string; start: string; end: string }[] | null | undefined, tz: string | null | undefined): string | null {
  if (!w?.length) return null;
  const spans = [...new Set(w.map((x) => `${x.start}–${x.end}`))];
  const days = w.map((x) => DAY_ISO[x.day.slice(0, 3).toLowerCase()]).filter(Boolean);
  if (spans.length === 1 && days.length) {
    const [start, end] = spans[0].split("–");
    return windowText({ tz: tz ?? "Voizo campaign time", days, startHour: Number(start.split(":")[0]), endHour: Number(end.split(":")[0]) });
  }
  return w.map((x) => `${x.day} ${x.start}–${x.end}`).join(", ") + (tz ? ` (${tz})` : "");
}

export async function loadCallPreview(leadId: string): Promise<CallPreview | null> {
  const db = getDb();
  const { data } = await db
    .from("leads")
    .select("id,business_name,phone,country_code,lifecycle_stage,call_status,email,verification_status,contact_owner_name")
    .eq("id", leadId)
    .maybeSingle();
  if (!data) return null;
  const lead = data as {
    id: string; business_name: string; phone: string | null; country_code: string | null; lifecycle_stage: string | null;
    call_status: string | null; email: string | null; verification_status: string | null; contact_owner_name: string | null;
  };
  const country = (lead.country_code ?? "us").toLowerCase();
  const tz = campaignTimezone(country);
  const configured = isVoizoConfigured();

  // Active call campaigns: is this lead already queued, and how many are ahead of it?
  const { data: camps } = await db.from("call_campaigns").select("id").eq("channel", "call").eq("status", "active");
  const campIds = ((camps ?? []) as { id: string }[]).map((c) => c.id);
  let queueAhead = 0;
  let alreadyQueued = false;
  let savedName: string | null = null;
  if (campIds.length) {
    const live = () =>
      db.from("campaign_leads").select("lead_id", { count: "exact", head: true })
        .in("campaign_id", campIds).in("status", ["pending", "called"]).lt("call_attempts", env.VOIZO_MAX_ATTEMPTS);
    const [{ count }, mine] = await Promise.all([
      live(),
      db.from("campaign_leads").select("call_name").eq("lead_id", leadId).in("campaign_id", campIds).in("status", ["pending", "called"]).limit(1),
    ]);
    queueAhead = count ?? 0;
    if (mine.error && isMissingColumn(mine.error, "call_name")) {
      const { data: m2 } = await db.from("campaign_leads").select("lead_id").eq("lead_id", leadId).in("campaign_id", campIds).in("status", ["pending", "called"]).limit(1);
      alreadyQueued = Boolean(m2?.length);
    } else {
      const rows = (mine.data ?? []) as { call_name: string | null }[];
      alreadyQueued = rows.length > 0;
      savedName = rows[0]?.call_name ?? null;
    }
    if (alreadyQueued) queueAhead = Math.max(0, queueAhead - 1);
  }

  let voizo: CallPreview["voizo"] = { configured, ready: null, remainingToday: null, dailyCap: null, windows: null, error: null };
  let script: CallPreview["script"] = { campaignName: null, shadow: null };
  if (configured) {
    const st = await getStatus();
    if (st.ok) {
      voizo = {
        configured,
        ready: st.data.ready,
        remainingToday: st.data.remainingToday ?? null,
        dailyCap: st.data.dailyCap ?? null,
        windows: voizoWindowsText(st.data.callWindows, st.data.timezone),
        error: null,
      };
      script = { campaignName: st.data.campaignName ?? null, shadow: st.data.shadow };
    } else {
      voizo = { ...voizo, error: st.error.slice(0, 160) };
    }
  }

  // A missing phone isn't a block here: the preview lets the operator type a number (e.g. their own, to test).
  const needsNumber = !lead.phone;
  let block = callBlock({ ...lead, phone: lead.phone ?? "typed-in-preview" });
  if (!block && !configured) block = "AI calling isn't connected (no Voizo key). Ask the admin.";

  return {
    leadId,
    businessName: lead.business_name,
    canCall: !block,
    block,
    needsNumber,
    phone: toE164(lead.phone, country) ?? lead.phone,
    ownerName: lead.contact_owner_name,
    greetingName: savedName ?? suggestGreetingName(lead.contact_owner_name),
    alreadyQueued,
    script,
    voizo,
    ourHours: windowText({ tz, days: [1, 2, 3, 4, 5, 6, 7], startHour: 9, endHour: 20 }),
    queueAhead,
    attempts: { max: env.VOIZO_MAX_ATTEMPTS, retryHours: env.VOIZO_RETRY_HOURS },
  };
}
