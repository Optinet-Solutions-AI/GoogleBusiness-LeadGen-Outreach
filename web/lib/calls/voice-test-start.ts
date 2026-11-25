/**
 * calls/voice-test-start.ts — "Test voice agent" on a lead: the offers (one Voizo script each), what the agent will be
 * told, and a Voizo test session for a browser call (20 Nov 2026). No phone number is ever dialled.
 *
 * Inputs:  lead id (+ greeting name + offer picked in the window); Voizo GET /api/v1/scripts and GET /api/v1/status
 *          (free) and POST /api/v1/test-calls (one session per Start press, valid 30 min, 50 a day per campaign)
 * Outputs: the window's data (offers with each script's tokens, the lead's details, the starting offer), or the
 *          session the browser hands to Vapi unchanged — or a plain message when Voizo refuses
 * Used by: app/api/leads/[id]/voice-test/route.ts
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getStatus, isVoizoConfigured, listScripts, startTestCall, type VoizoTestCall } from "@/lib/services/voizo";
import { SERVICES } from "@/lib/email/service-templates";
import { defaultVoiceOffer, testCapText, pickScript, VOICE_OFFERS, voiceVariables, type VoiceLead, type VoiceScript, type VoiceVariables } from "./voice-test";
import { pickTalkingPoints, templateLeadOf, type TalkingLead } from "./talking-points";
import { lastEmailFor, talkingPointsFor, talkingPointsVar } from "./talking-points-load";

export interface VoiceTestOffer {
  key: string;
  label: string;
  /** The Voizo campaign that runs this offer's script; null = Voizo's default (no script list). */
  campaignId: string | null;
  /** The script's {{tokens}}; null = unknown. */
  scriptVariables: string[] | null;
}

export interface VoiceTestPreview {
  configured: boolean;
  businessName: string;
  /** Always null since 25 Nov 2026: the agents never say the person's name. */
  greeting: string | null;
  /** Per offer: the email the agent gets as background (talkingPoints, never read out); missing = none. */
  talkingPoints: Record<string, { text: string; source: "sent" | "ready_made" }>;
  /** The lead's details without the offer (the window adds the offer picked). */
  baseVariables: VoiceVariables;
  offers: VoiceTestOffer[];
  /** The offer the window starts on (what Send email would pick, when Voizo has a script for it). */
  offerKey: string | null;
}

async function loadLead(leadId: string): Promise<{ lead: VoiceLead & TalkingLead; batchCity: string | null }> {
  const db = getDb();
  const { data, error } = await db
    .from("leads")
    .select("business_name,contact_owner_name,category,primary_offer,signal_type,signal_meta,call_segment,has_website,website_kind,needs_improvement,demo_url,batch_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Lead not found");
  const row = data as VoiceLead & TalkingLead & { batch_id: string | null };
  const batch = row.batch_id ? (await db.from("batches").select("city").eq("id", row.batch_id).maybeSingle()).data : null;
  return { lead: row, batchCity: (batch as { city: string | null } | null)?.city ?? null };
}

const labelFor = (key: string, fallback: string) => SERVICES.find((s) => s.key === key)?.label ?? fallback;

/** Voizo's scripts named to an offer (offerKey set); [] when the list can't be read. */
async function scripts(): Promise<VoiceScript[]> {
  const r = await listScripts();
  if (!r.ok) return [];
  return r.data.scripts
    .filter((s) => s.offerKey)
    .map((s) => ({ campaignId: s.campaignId, offerKey: s.offerKey ?? null, name: s.name ?? s.offerKey ?? "", scriptVariables: s.scriptVariables ?? null, canDial: Boolean(s.canDial) }));
}

export async function previewVoiceTest(leadId: string): Promise<VoiceTestPreview> {
  const { lead, batchCity } = await loadLead(leadId);
  const { offer: _offer, ...baseVariables } = voiceVariables(lead, "", batchCity);
  void _offer;
  const configured = isVoizoConfigured();
  const list = configured ? await scripts() : [];
  let offers: VoiceTestOffer[];
  if (list.length) {
    offers = list.map((s) => ({ key: s.offerKey!, label: labelFor(s.offerKey!, s.name), campaignId: s.campaignId, scriptVariables: s.scriptVariables }));
  } else {
    // No script list (Voizo down / older Voizo): every offer on Voizo's default script.
    const st = configured ? await getStatus() : null;
    const vars = st?.ok ? (st.data.scriptVariables ?? null) : null;
    offers = VOICE_OFFERS.map((o) => ({ key: o.key, label: o.label, campaignId: null, scriptVariables: vars }));
  }
  const wanted = defaultVoiceOffer(lead);
  const offerKey = offers.some((o) => o.key === wanted) ? wanted : (offers[0]?.key ?? null);
  // What each offer's call would get as talking points (one lookup of the last email; never blocks the window).
  const last = await lastEmailFor(leadId).catch(() => null);
  const tl = templateLeadOf(lead, batchCity);
  const talkingPoints: VoiceTestPreview["talkingPoints"] = {};
  for (const o of offers) {
    const tp = pickTalkingPoints(o.key, last, tl);
    if (tp) talkingPoints[o.key] = tp;
  }
  return { configured, businessName: lead.business_name, greeting: null, talkingPoints, baseVariables, offers, offerKey };
}

const REFUSED: Record<string, string> = {
  cap_unverifiable: "Voizo isn't ready for test calls yet (its database update isn't applied). Try again later.",
  campaign_unusable: "That offer's Voizo script isn't set up for API calls. Ask whoever runs Voizo.",
  unauthorized: "Voizo refused our API key. Ask the admin.",
  not_configured: "AI calling isn't connected (no Voizo key). Ask the admin.",
};

export async function startVoiceTest(
  leadId: string,
  typedName: string | null,
  offerKey: string | null,
): Promise<{ ok: true; session: VoizoTestCall } | { ok: false; message: string }> {
  const { lead, batchCity } = await loadLead(leadId);
  // The script is looked up here, not taken from the browser.
  const script = pickScript(await scripts(), offerKey);
  const offer = offerKey && VOICE_OFFERS.some((o) => o.key === offerKey) ? offerKey : defaultVoiceOffer(lead);
  // No name (the agents never say it, 25 Nov 2026); the offer's email as talking points, as on a real call.
  void typedName;
  const talking = await talkingPointsFor(leadId, offer, lead, batchCity);
  const variables = { ...voiceVariables(lead, offer, batchCity), ...talkingPointsVar(talking) };
  const r = await startTestCall({ name: null, variables, campaignId: script?.campaignId ?? null });
  if (r.ok) return { ok: true, session: r.data };
  if (r.code === "test_cap_reached") return { ok: false, message: testCapText(r.cap) };
  return { ok: false, message: REFUSED[r.code] ?? `Voizo couldn't start the test call (${r.code}). Try again.` };
}
