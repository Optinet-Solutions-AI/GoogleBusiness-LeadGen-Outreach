/**
 * calls/recording-capture.ts — copy an AI call's recording from Vapi into our private bucket (19 Nov 2026).
 *
 * Inputs:  call_attempts rows (meta.vapi_call_id saved when the call ended); VAPI_API_KEY via lib/services/vapi.ts
 * Outputs: the audio at call-recordings/<attempt id>.<ext>, call_attempts.recording_url = that path, and
 *          meta.recording_state (copied · none_at_vapi · no_access · lost; absent = not ready yet). Never throws.
 * Used by: lib/pipeline/call-scheduler.ts (after a call ends + a sweep at the start of every call tick)
 *
 * Vapi deletes recordings after 14 days, so we keep our own copy. Voizo is not involved (our calls stay out of its
 * dashboard and reports). Rules (which link, wait/give up, file type) live in lib/calls/recordings.ts.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { downloadAudio, getVapiCall, isVapiConfigured } from "@/lib/services/vapi";
import { nextRecordingStep, pickRecordingUrl, recordingExt, RECORDING_RETRY_DAYS, type RecordingState } from "./recordings";

const log = getLogger("call.recording");

export const RECORDINGS_BUCKET = "call-recordings";

export interface CaptureInput {
  id: string;
  meta: Record<string, unknown> | null;
  ended_at: string | null;
  created_at: string;
}

/** "unreachable" = Vapi itself failed (down / timing out): the sweep stops trying the other rows this tick. */
export type CaptureResult = RecordingState | "wait" | "off" | "error" | "unreachable";

let bucketReady = false;
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  // Private: recordings are only reachable through short-lived signed links (lib/calls/call-logs.ts).
  await getDb().storage.createBucket(RECORDINGS_BUCKET, { public: false }).catch(() => undefined);
  bucketReady = true;
}

async function saveState(a: CaptureInput, state: RecordingState, recordingUrl?: string): Promise<void> {
  const patch: Record<string, unknown> = { meta: { ...(a.meta ?? {}), recording_state: state } };
  if (recordingUrl) patch.recording_url = recordingUrl;
  const { error } = await getDb().from("call_attempts").update(patch).eq("id", a.id);
  if (error) log.warn({ attempt_id: a.id, err: error.message }, "call.recording.save_failed");
}

export async function captureRecording(a: CaptureInput): Promise<CaptureResult> {
  if (!isVapiConfigured()) return "off";
  const vapiId = typeof a.meta?.vapi_call_id === "string" ? a.meta.vapi_call_id : null;
  if (!vapiId) return "error";
  const endedAt = a.ended_at ?? a.created_at;
  try {
    if (nextRecordingStep({ linkFound: false, endedAt, now: Date.now() }) === "lost") {
      await saveState(a, "lost");
      return "lost";
    }
    const call = await getVapiCall(vapiId);
    if (!call.ok) {
      if (call.code === "no_access") {
        await saveState(a, "no_access");
        return "no_access";
      }
      return call.code === "network_error" || call.code === "http_error" ? "unreachable" : "error";
    }
    const link = pickRecordingUrl(call.data);
    const step = nextRecordingStep({ linkFound: Boolean(link), endedAt, now: Date.now() });
    if (step === "wait") return "wait";
    if (step !== "download" || !link) {
      await saveState(a, step === "lost" ? "lost" : "none_at_vapi");
      return step === "lost" ? "lost" : "none_at_vapi";
    }
    const audio = await downloadAudio(link);
    if (!audio.ok) {
      log.warn({ attempt_id: a.id, err: audio.error }, "call.recording.download_failed");
      return "error";
    }
    const ext = recordingExt(link, audio.contentType);
    const path = `${a.id}.${ext}`;
    await ensureBucket();
    const { error } = await getDb()
      .storage.from(RECORDINGS_BUCKET)
      .upload(path, audio.bytes, { contentType: audio.contentType?.split(";")[0] || `audio/${ext === "mp3" ? "mpeg" : ext}`, upsert: true });
    if (error) {
      log.warn({ attempt_id: a.id, err: error.message }, "call.recording.upload_failed");
      return "error";
    }
    await saveState(a, "copied", path);
    log.info({ attempt_id: a.id, path, bytes: audio.bytes.byteLength }, "call.recording.copied");
    return "copied";
  } catch (err) {
    log.warn({ attempt_id: a.id, err: String(err).slice(0, 200) }, "call.recording.failed");
    return "error";
  }
}

/**
 * Retry finished calls whose recording isn't saved yet (newest first, ≤ limit). Runs at the start of every call tick,
 * before any early exit, so a recording arrives within ~15 min even when nothing is dialled. Never throws.
 * Bounded so a slow or down Vapi can't eat the dial budget: stops after `budgetMs` and at the first Vapi failure.
 */
export async function sweepRecordings(limit = 10, budgetMs = 90_000): Promise<number> {
  if (!isVapiConfigured()) return 0;
  try {
    const since = new Date(Date.now() - (RECORDING_RETRY_DAYS + 7) * 86_400_000).toISOString();
    const { data, error } = await getDb()
      .from("call_attempts")
      .select("id,meta,ended_at,created_at")
      .eq("provider", "voizo")
      .eq("done", true)
      .is("recording_url", null)
      .not("meta->>vapi_call_id", "is", null)
      .or("meta->>recording_state.is.null,meta->>recording_state.eq.no_access")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      log.warn({ err: error.message }, "call.recording.sweep_read_failed");
      return 0;
    }
    let copied = 0;
    let noAccess = 0;
    const deadline = Date.now() + budgetMs;
    for (const row of (data ?? []) as CaptureInput[]) {
      if (Date.now() >= deadline) break;
      const r = await captureRecording(row);
      if (r === "unreachable") {
        log.warn("call.recording.sweep_stopped — Vapi unreachable, retrying next tick");
        break;
      }
      if (r === "copied") copied += 1;
      if (r === "no_access") noAccess += 1;
    }
    if (noAccess) log.warn({ calls: noAccess }, "call.recording.no_access — VAPI_API_KEY can't read our calls (wrong Vapi account?)");
    if (copied) log.info({ copied }, "call.recording.sweep");
    return copied;
  } catch (err) {
    log.warn({ err: String(err).slice(0, 200) }, "call.recording.sweep_failed");
    return 0;
  }
}

/** The voice agent's name for a Voizo campaign id (saved on the call at dial time); null when none / not found. */
export async function agentNameFor(voizoCampaignId: string | null): Promise<string | null> {
  if (!voizoCampaignId) return null;
  try {
    const { data } = await getDb().from("voice_agents").select("name").eq("voizo_campaign_id", voizoCampaignId).limit(1).maybeSingle();
    return (data as { name?: string } | null)?.name ?? null;
  } catch {
    return null;
  }
}
