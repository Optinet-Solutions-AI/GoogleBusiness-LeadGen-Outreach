/**
 * vapi.ts — read-only Vapi client: one AI call's details (its recording links) and the recording bytes (19 Nov 2026).
 *
 * Inputs:  VAPI_API_KEY (the private key of the Vapi account Voizo dials through; server only); a Vapi call id
 * Outputs: { ok, data } | { ok:false, code } — never throws. Nothing is created or changed at Vapi.
 * Used by: lib/calls/recording-capture.ts (Cloud Run call worker)
 *
 * GET https://api.vapi.ai/call/{id} returns the call with `artifact` recording links (presigned ones expire in ~30 min,
 * so the bytes are downloaded straight away). Vapi keeps recordings 14 days. 401/403/404 = the key can't see the call
 * (wrong account) → "no_access". Voizo is not involved.
 */
import "@/lib/server-guard";
import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("vapi");
const BASE = "https://api.vapi.ai";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export type VapiCallResult =
  | { ok: true; data: unknown }
  | { ok: false; code: "not_configured" | "no_access" | "network_error" | "http_error"; status: number };

export function isVapiConfigured(): boolean {
  return Boolean(env.VAPI_API_KEY);
}

class RetryableStatus extends Error {}

export async function getVapiCall(vapiCallId: string): Promise<VapiCallResult> {
  if (!isVapiConfigured()) return { ok: false, code: "not_configured", status: 0 };
  const url = `${BASE}/call/${encodeURIComponent(vapiCallId)}`;
  const init: RequestInit = { headers: { Authorization: `Bearer ${env.VAPI_API_KEY}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) };
  let resp: Response;
  try {
    resp = await retry(
      async () => {
        const r = await fetch(url, init);
        if (r.status >= 500) throw new RetryableStatus(String(r.status));
        return r;
      },
      { maxAttempts: 3, initialMs: 1000 },
    );
  } catch (err) {
    log.warn({ vapi_call_id: vapiCallId, err: String(err).slice(0, 200) }, "vapi.call.failed");
    return err instanceof RetryableStatus
      ? { ok: false, code: "http_error", status: Number(err.message) || 500 }
      : { ok: false, code: "network_error", status: 0 };
  }
  if ([401, 403, 404].includes(resp.status)) {
    log.warn({ vapi_call_id: vapiCallId, status: resp.status }, "vapi.call.no_access");
    return { ok: false, code: "no_access", status: resp.status };
  }
  if (!resp.ok) {
    log.warn({ vapi_call_id: vapiCallId, status: resp.status }, "vapi.call.refused");
    return { ok: false, code: "http_error", status: resp.status };
  }
  const data = (await resp.json().catch(() => null)) as unknown;
  log.info({ vapi_call_id: vapiCallId }, "vapi.call.ok");
  return { ok: true, data };
}

/** Download one recording (https only, no redirects, ≤ 50 MB). */
export async function downloadAudio(
  url: string,
): Promise<{ ok: true; bytes: ArrayBuffer; contentType: string | null } | { ok: false; error: string }> {
  if (!/^https:\/\//i.test(url)) return { ok: false, error: "not an https link" };
  try {
    const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return { ok: false, error: `http ${r.status}` };
    const size = Number(r.headers.get("content-length") ?? 0);
    if (size > MAX_AUDIO_BYTES) return { ok: false, error: "recording too large" };
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength > MAX_AUDIO_BYTES) return { ok: false, error: "recording too large" };
    log.info({ bytes: bytes.byteLength }, "vapi.audio.ok");
    return { ok: true, bytes, contentType: r.headers.get("content-type") };
  } catch (err) {
    log.warn({ err: String(err).slice(0, 200) }, "vapi.audio.failed");
    return { ok: false, error: String(err).slice(0, 200) };
  }
}
