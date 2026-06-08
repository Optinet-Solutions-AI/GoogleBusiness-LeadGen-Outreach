/**
 * api/voice/test-calls/[id]/recording/route.ts — Download a saved test call's audio recording.
 *
 * Inputs:  GET (saved-call row id in path)
 * Outputs: the recording streamed as an attachment (Content-Disposition) so the browser SAVES it
 *          with a sensible filename instead of playing it inline.
 * Used by: components/SavedTestCalls.tsx ("Download recording").
 *
 * The recording lives on a cross-origin Vapi URL, where the <a download> attribute is ignored —
 * hence this same-origin proxy. The URL is resolved SERVER-SIDE from our own test_calls row (or via
 * Vapi by vapi_call_id), never taken from the client, so this can't be turned into an open proxy.
 */
import { withApi } from "@/lib/api-wrap";
import { fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { getCall, isVapiConfigured } from "@/lib/services/voice/vapi-admin";

export const dynamic = "force-dynamic";

interface TestCallRow {
  recording_url: string | null;
  vapi_call_id: string | null;
  created_at: string;
}

/** Filename stamp from the call's created_at, e.g. "2026-06-08-1430". */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recording";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Vapi serves wav or mp3; default mp3 when the path gives no hint. */
function extFrom(url: string): "mp3" | "wav" {
  try {
    if (new URL(url).pathname.toLowerCase().endsWith(".wav")) return "wav";
  } catch {
    /* fall through to default */
  }
  return "mp3";
}

export const GET = withApi(async (_req, ctx) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const id = ctx?.params?.id;
  if (!id) return fail("Missing id", 400);

  const { data, error } = await getDb()
    .from("test_calls")
    .select("recording_url,vapi_call_id,created_at")
    .eq("id", id)
    .single();
  if (error) return fail(error.message, 502);
  const row = data as TestCallRow | null;
  if (!row) return fail("Call not found", 404);

  // Prefer the stored URL; fall back to resolving fresh from Vapi by call id.
  let url = row.recording_url;
  if (!url && row.vapi_call_id && isVapiConfigured()) {
    url = (await getCall(row.vapi_call_id)).recordingUrl;
  }
  if (!url) return fail("No recording for this call", 404);

  const upstream = await fetch(url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return fail(`Could not fetch recording (${upstream.status})`, 502);
  }

  const ext = extFrom(url);
  const headers = new Headers();
  headers.set(
    "Content-Type",
    upstream.headers.get("content-type") ?? (ext === "wav" ? "audio/wav" : "audio/mpeg"),
  );
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set("Content-Disposition", `attachment; filename="test-call-${stamp(row.created_at)}.${ext}"`);
  headers.set("Cache-Control", "no-store");

  // Stream the body straight through — no buffering the whole file in memory.
  return new Response(upstream.body, { status: 200, headers });
});
