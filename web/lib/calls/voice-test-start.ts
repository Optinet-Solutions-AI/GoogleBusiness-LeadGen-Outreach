/**
 * calls/voice-test-start.ts — "Test voice agent" on a lead: what the agent will be told, and a Voizo test session
 * for a browser call (20 Nov 2026). No phone number is ever dialled.
 *
 * Inputs:  lead id (+ a greeting name typed in the window); Voizo GET /api/v1/status (free) and
 *          POST /api/v1/test-calls (one single-use session per Start press, 50 a day per campaign)
 * Outputs: the details shown in the window (+ which script tokens this lead can't fill), or the session the browser
 *          hands to Vapi unchanged — or a plain message when Voizo refuses
 * Used by: app/api/leads/[id]/voice-test/route.ts
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getStatus, isVoizoConfigured, startTestCall, type VoizoTestCall } from "@/lib/services/voizo";
import { greetingFor, missingScriptVariables, voiceVariables, type VoiceLead, type VoiceVariables } from "./voice-test";

export interface VoiceTestPreview {
  configured: boolean;
  businessName: string;
  greeting: string | null;
  variables: VoiceVariables;
  scriptName: string | null;
  /** Tokens the script uses that this lead can't fill; null = Voizo couldn't read the script. */
  missing: string[] | null;
}

async function loadLead(leadId: string): Promise<VoiceLead> {
  const { data, error } = await getDb()
    .from("leads")
    .select("business_name,contact_owner_name,category,primary_offer,signal_type,signal_meta")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Lead not found");
  return data as VoiceLead;
}

export async function previewVoiceTest(leadId: string): Promise<VoiceTestPreview> {
  const lead = await loadLead(leadId);
  const variables = voiceVariables(lead);
  const greeting = greetingFor(lead);
  const configured = isVoizoConfigured();
  const st = configured ? await getStatus() : null;
  const scriptVariables = st?.ok ? (st.data.scriptVariables ?? null) : null;
  return {
    configured,
    businessName: lead.business_name,
    greeting,
    variables,
    scriptName: st?.ok ? (st.data.campaignName ?? null) : null,
    missing: missingScriptVariables(scriptVariables, variables, greeting),
  };
}

const REFUSED: Record<string, string> = {
  test_cap_reached: "Voizo's limit of 50 test calls a day is used up. Try again tomorrow.",
  cap_unverifiable: "Voizo isn't ready for test calls yet (its database update isn't applied). Try again later.",
  campaign_unusable: "The Voizo campaign isn't set up for API calls. Ask whoever runs Voizo.",
  unauthorized: "Voizo refused our API key. Ask the admin.",
  not_configured: "AI calling isn't connected (no Voizo key). Ask the admin.",
};

export async function startVoiceTest(
  leadId: string,
  typedName: string | null,
): Promise<{ ok: true; session: VoizoTestCall } | { ok: false; message: string }> {
  const lead = await loadLead(leadId);
  const r = await startTestCall({ name: greetingFor(lead, typedName), variables: voiceVariables(lead) });
  if (r.ok) return { ok: true, session: r.data };
  return { ok: false, message: REFUSED[r.code] ?? `Voizo couldn't start the test call (${r.code}). Try again.` };
}
