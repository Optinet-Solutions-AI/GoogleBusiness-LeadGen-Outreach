/**
 * calls/recordings.ts — the rules for AI call recordings + transcripts (19 Nov 2026). Pure, client-safe.
 *
 * Inputs:  a Vapi call object (recording links), call_attempts fields (recording_url, meta, times), lead phone
 * Outputs: which link to download, file extension + download name, what to do next (download / wait / give up),
 *          the plain message for the page, agent / result / test-number labels, the transcript .txt text
 * Used by: lib/calls/recording-capture.ts (Cloud Run call worker), lib/calls/call-logs.ts, components/calls/*
 */
import { toE164 } from "@/lib/phone";

export type RecordingState = "copied" | "none_at_vapi" | "no_access" | "lost";

/** Vapi keeps a recording 14 days; we stop trying a day before. */
export const RECORDING_RETRY_DAYS = 13;
/** A recording can take a moment to appear after the call: no link in this window = not ready yet. */
export const NOT_READY_GRACE_MS = 2 * 3600_000;

const DAY_MS = 86_400_000;

function at(o: unknown, ...path: string[]): unknown {
  let cur = o;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** The first https recording link on a Vapi call (presigned links first: they work for old and new calls). */
export function pickRecordingUrl(vapiCall: unknown): string | null {
  const candidates = [
    at(vapiCall, "artifact", "presignedMonoUrl"),
    at(vapiCall, "artifact", "presignedStereoUrl"),
    at(vapiCall, "artifact", "recording", "mono", "combinedUrl"),
    at(vapiCall, "artifact", "recordingUrl"),
    at(vapiCall, "recordingUrl"),
  ];
  for (const c of candidates) if (typeof c === "string" && /^https:\/\//i.test(c)) return c;
  return null;
}

const EXTS = ["mp3", "wav", "ogg", "webm"] as const;
type Ext = (typeof EXTS)[number];

export function recordingExt(url: string, contentType: string | null): Ext {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct === "audio/mpeg" || ct === "audio/mp3") return "mp3";
  if (ct === "audio/wav" || ct === "audio/x-wav" || ct === "audio/wave") return "wav";
  if (ct === "audio/ogg") return "ogg";
  if (ct === "audio/webm") return "webm";
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* not a URL: use as is */
  }
  const m = /\.([a-z0-9]+)$/i.exec(path);
  const ext = m?.[1].toLowerCase();
  return (EXTS as readonly string[]).includes(ext ?? "") ? (ext as Ext) : "wav";
}

export function nextRecordingStep(o: { linkFound: boolean; endedAt: string; now: number }): "download" | "wait" | "none_at_vapi" | "lost" {
  const age = o.now - Date.parse(o.endedAt);
  if (age > RECORDING_RETRY_DAYS * DAY_MS) return "lost";
  if (o.linkFound) return "download";
  return age < NOT_READY_GRACE_MS ? "wait" : "none_at_vapi";
}

export function recordingMessage(o: {
  recordingUrl: string | null;
  state: string | null;
  hasVapiId: boolean;
  endedAt: string | null;
  now: number;
  keySet: boolean;
}): { kind: "ready" | "pending" | "none"; text: string } {
  if (o.recordingUrl) return { kind: "ready", text: "" };
  if (!o.hasVapiId) return { kind: "none", text: "No recording for this call" };
  if (o.state === "none_at_vapi") return { kind: "none", text: "Vapi has no recording for this call" };
  const expired = o.state === "lost" || (o.endedAt != null && o.now - Date.parse(o.endedAt) > RECORDING_RETRY_DAYS * DAY_MS);
  if (expired) return { kind: "none", text: "Recording expired at Vapi" };
  if (!o.keySet) return { kind: "none", text: "Recordings are off (no Vapi key)" };
  if (o.state === "no_access") return { kind: "none", text: "Recordings are off: the Vapi key can't read this call" };
  return { kind: "pending", text: "Recording not ready yet (fetched within 15 min of the call)" };
}

/** The voice agent a call used: the name saved at dial time; calls from before that was saved show "—". */
export function agentLabel(meta: Record<string, unknown> | null): string {
  if (!meta || !Object.prototype.hasOwnProperty.call(meta, "agent_name")) return "—";
  if (typeof meta.agent_name === "string" && meta.agent_name) return meta.agent_name;
  if (typeof meta.voizo_campaign_id === "string" && meta.voizo_campaign_id) return meta.voizo_campaign_id;
  return "Voizo default";
}

/**
 * The agent name saved on a call at dial time: the agent picked in Call with AI, else the Voizo script the calls run on
 * (Voizo's own campaign name, "Lead Gen API (shadow)"). A picked agent with no saved name → null (Call logs shows its id).
 */
export function dialAgentName(pickedCampaignId: string | null, pickedName: string | null, voizoScriptName: string | null): string | null {
  if (pickedCampaignId) return pickedName;
  return voizoScriptName;
}

/** A test call made in the browser (Test voice agent), not a phone call. */
export function isBrowserTest(meta: Record<string, unknown> | null): boolean {
  return meta?.call_type === "browser_test";
}

/** "Test (browser)" or "Real call", for Call logs. */
export function callTypeLabel(meta: Record<string, unknown> | null): string {
  return isBrowserTest(meta) ? "Test (browser)" : "Real call";
}

/** Did this call ring a test number (typed in Call with AI) instead of the lead? Saved flag first, else compare. */
export function isTestCall(meta: Record<string, unknown> | null, leadPhone: string | null, countryCode: string | null): boolean {
  if (typeof meta?.test_number === "boolean") return meta.test_number;
  const dialled = typeof meta?.phone === "string" ? toE164(meta.phone) : null;
  const own = toE164(leadPhone, countryCode);
  return Boolean(dialled && own && dialled !== own);
}

export function downloadName(business: string, isoDate: string, ext: string): string {
  const slug =
    business
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "call";
  return `${slug}-${isoDate.slice(0, 10)}.${ext}`;
}

function duration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
}

export function transcriptTxt(c: {
  business: string;
  date: string;
  phone: string | null;
  agent: string;
  result: string;
  durationSec: number | null;
  transcript: string | null;
}): string {
  const when = c.date.slice(0, 16).replace("T", " ") + " UTC";
  return [
    `AI call — ${c.business}`,
    `When: ${when}`,
    `Number: ${c.phone ?? "—"}`,
    `Voice agent: ${c.agent}`,
    `Result: ${c.result}`,
    `Length: ${duration(c.durationSec)}`,
    "",
    c.transcript?.trim() || "(no transcript)",
    "",
  ].join("\n");
}

export const RESULT_FILTERS = {
  interested: { outcome: "interested" },
  not_interested: { outcome: "not_interested" },
  callback: { outcome: "callback" },
  no_answer: { status: ["no_answer", "voicemail", "busy"] },
  failed: { status: ["failed", "canceled", "unknown"] },
} as const satisfies Record<string, { outcome?: string; status?: readonly string[] }>;
export type ResultFilter = keyof typeof RESULT_FILTERS;

export function resultLabel(row: { status: string; outcome: string | null }): string {
  return (row.outcome ?? row.status).replace(/_/g, " ");
}
