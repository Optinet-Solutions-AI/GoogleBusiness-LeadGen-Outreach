"use client";

/**
 * VapiTestCall.tsx — in-browser "Test call" to a Vapi assistant, as a chat panel.
 *
 * Mic-based web call (no phone number, no telephony) so you can test the live agent's
 * script + voice from anywhere. Uses the Vapi WEB SDK with the PUBLIC key (client-safe).
 * The SDK is dynamically imported inside an effect so it never runs during SSR.
 *
 * The transcript renders like a messaging thread (bubbles, agent left / you right) in a
 * fixed-height, self-scrolling panel so a long call never pushes the page down. When the call
 * ends, it polls /api/voice/call/[id] for the recording and shows a replay player + summary.
 *
 * Env (NEXT_PUBLIC, baked at build time): NEXT_PUBLIC_VAPI_PUBLIC_KEY + NEXT_PUBLIC_VAPI_TEST_ASSISTANT_ID.
 */

import { useEffect, useRef, useState } from "react";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_TEST_ASSISTANT_ID;

type Status = "idle" | "connecting" | "live" | "ended" | "error";
type RecordingState = "idle" | "loading" | "ready" | "none";

interface Line {
  role: string;
  text: string;
}
interface Recording {
  recordingUrl: string | null;
  durationSeconds: number | null;
  summary: string | null;
}

export function VapiTestCall() {
  const vapiRef = useRef<any>(null);
  const callIdRef = useRef<string | null>(null);
  const pollTokenRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [recState, setRecState] = useState<RecordingState>("idle");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Poll the finished call for its recording — it appears a few seconds after hangup.
  function fetchRecording(callId: string) {
    const token = ++pollTokenRef.current;
    setRecState("loading");
    setRecording(null);

    const attempt = async (n: number) => {
      if (token !== pollTokenRef.current) return; // a newer call superseded this poll
      try {
        const res = await fetch(`/api/voice/call/${callId}`, { cache: "no-store" });
        const json = await res.json();
        if (token !== pollTokenRef.current) return;
        if (json.success && json.data?.recordingUrl) {
          setRecording({
            recordingUrl: json.data.recordingUrl,
            durationSeconds: json.data.durationSeconds ?? null,
            summary: json.data.summary ?? null,
          });
          setRecState("ready");
          return;
        }
      } catch {
        /* keep polling */
      }
      if (n >= 10) {
        if (token === pollTokenRef.current) setRecState("none");
        return;
      }
      setTimeout(() => attempt(n + 1), 3000);
    };

    // first check after 3s — recording is never ready instantly
    setTimeout(() => attempt(1), 3000);
  }

  useEffect(() => {
    if (!PUBLIC_KEY || !ASSISTANT_ID) return;
    let mounted = true;
    (async () => {
      const Vapi = (await import("@vapi-ai/web")).default;
      if (!mounted) return;
      const vapi = new Vapi(PUBLIC_KEY);
      vapiRef.current = vapi;
      vapi.on("call-start", () => setStatus("live"));
      vapi.on("call-end", () => {
        setStatus("ended");
        setSpeaking(false);
        if (callIdRef.current) fetchRecording(callIdRef.current);
      });
      vapi.on("speech-start", () => setSpeaking(true));
      vapi.on("speech-end", () => setSpeaking(false));
      vapi.on("error", (e: any) => {
        setErr(typeof e === "string" ? e : e?.message ?? e?.error?.message ?? "Call error");
        setStatus("error");
      });
      vapi.on("message", (m: any) => {
        if (m?.type === "transcript" && (m.transcriptType === "final" || !m.transcriptType)) {
          setLines((prev) => [...prev, { role: m.role ?? "?", text: String(m.transcript ?? "") }]);
        }
      });
      setReady(true);
    })();
    return () => {
      mounted = false;
      pollTokenRef.current++; // cancel any in-flight poll
      try {
        vapiRef.current?.stop?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Auto-scroll the thread to the newest line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, recState]);

  if (!PUBLIC_KEY || !ASSISTANT_ID) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-6 text-[13px] text-ink-muted">
        Set <code className="font-mono text-ink">NEXT_PUBLIC_VAPI_PUBLIC_KEY</code> and{" "}
        <code className="font-mono text-ink">NEXT_PUBLIC_VAPI_TEST_ASSISTANT_ID</code> in the
        environment (and redeploy) to enable the in-app test call.
      </div>
    );
  }

  const inCall = status === "connecting" || status === "live";

  const start = async () => {
    setErr(null);
    setLines([]);
    setRecording(null);
    setRecState("idle");
    setSaveState("idle");
    callIdRef.current = null;
    pollTokenRef.current++; // cancel any previous poll
    setStatus("connecting");
    try {
      const call = await vapiRef.current?.start(ASSISTANT_ID);
      callIdRef.current = call?.id ?? null;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the call");
      setStatus("error");
    }
  };
  const stop = () => {
    try {
      vapiRef.current?.stop();
    } catch {
      /* ignore */
    }
    setStatus("ended");
    if (callIdRef.current) fetchRecording(callIdRef.current);
  };

  // Save the conversation to History — ONLY when the operator clicks (no automatic save).
  async function handleSave() {
    if (saveState === "saving" || saveState === "saved" || lines.length === 0) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/voice/test-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vapiCallId: callIdRef.current ?? undefined,
          agentId: ASSISTANT_ID,
          transcript: lines,
          recordingUrl: recording?.recordingUrl ?? undefined,
          summary: recording?.summary ?? undefined,
          durationSeconds: recording?.durationSeconds ?? undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSaveState("saved");
        if (typeof window !== "undefined") window.dispatchEvent(new Event("test-call-saved"));
      } else {
        setSaveState("error");
      }
    } catch {
      setSaveState("error");
    }
  }

  // Download the conversation as a plain-text file (lands in your browser's Downloads folder).
  const downloadTranscript = () => {
    const text = lines
      .map((l) => `${l.role === "assistant" ? "Agent" : l.role === "user" ? "You" : l.role}: ${l.text}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "test-call-transcript.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusLabel: Record<Status, string> = {
    idle: "Ready",
    connecting: "Connecting…",
    live: speaking ? "Agent speaking…" : "Listening…",
    ended: "Call ended",
    error: "Error",
  };
  const dot =
    status === "live"
      ? "bg-positive"
      : status === "connecting"
        ? "bg-warning"
        : status === "error"
          ? "bg-urgent"
          : "bg-ink-subtle";

  return (
    <div className="bg-surface border border-rule rounded-lg overflow-hidden flex flex-col">
      {/* Header: status + start/end */}
      <div className="px-4 py-3 border-b border-rule flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dot} ${status === "live" ? "animate-pulse" : ""}`} />
          <span className="text-[13px] text-ink-muted truncate">{statusLabel[status]}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lines.length > 0 && !inCall && (
            <button
              onClick={handleSave}
              disabled={saveState === "saving" || saveState === "saved"}
              className="text-[12px] font-medium text-action hover:opacity-80 transition-opacity bg-transparent border-0 p-0 cursor-pointer disabled:opacity-60 disabled:text-positive"
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved ✓"
                  : saveState === "error"
                    ? "Retry save"
                    : "Save to history"}
            </button>
          )}
          {lines.length > 0 && !inCall && (
            <button
              onClick={downloadTranscript}
              className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink transition-colors bg-transparent border-0 p-0 cursor-pointer"
            >
              Download .txt
            </button>
          )}
          {inCall ? (
            <button
              onClick={stop}
              className="px-3.5 py-1.5 rounded bg-urgent text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
            >
              End call
            </button>
          ) : (
            <button
              onClick={start}
              disabled={!ready}
              className="px-3.5 py-1.5 rounded bg-action text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {ready ? (status === "ended" ? "Call again" : "Start test call") : "Loading…"}
            </button>
          )}
        </div>
      </div>

      {/* Chat thread (own scroll — never grows the page) */}
      <div ref={scrollRef} className="px-4 py-4 space-y-2.5 overflow-y-auto h-[52vh] min-h-[280px]">
        {lines.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-center text-[13px] text-ink-muted max-w-[28ch]">
              Start a call and talk to the agent — the conversation shows up here like a chat.
            </p>
          </div>
        ) : (
          lines.map((l, i) => {
            const isAgent = l.role === "assistant";
            return (
              <div key={i} className={`flex ${isAgent ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] ${isAgent ? "" : "items-end"}`}>
                  <span
                    className={`block text-label-caps uppercase tracking-[0.14em] mb-0.5 ${
                      isAgent ? "text-action text-left" : "text-ink-subtle text-right"
                    }`}
                  >
                    {isAgent ? "Agent" : l.role === "user" ? "You" : l.role}
                  </span>
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-[13px] leading-[1.45] ${
                      isAgent
                        ? "bg-canvas border border-rule text-ink rounded-tl-sm"
                        : "bg-action text-white rounded-tr-sm"
                    }`}
                  >
                    {l.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Recording replay (after the call ends) */}
      {status === "ended" && (
        <div className="px-4 py-3 border-t border-rule bg-canvas/40">
          {recState === "loading" && (
            <p className="text-[12px] text-ink-muted animate-pulse">Preparing the recording…</p>
          )}
          {recState === "none" && (
            <p className="text-[12px] text-ink-subtle">
              No recording available for this call (recording may be off for this assistant).
            </p>
          )}
          {recState === "ready" && recording?.recordingUrl && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow">Recording</span>
                {recording.durationSeconds != null && (
                  <span className="text-[11.5px] text-ink-subtle">
                    {Math.floor(recording.durationSeconds / 60)}m {recording.durationSeconds % 60}s
                  </span>
                )}
              </div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={recording.recordingUrl} className="w-full h-9" />
              {recording.summary && (
                <p className="text-[12px] text-ink-muted leading-relaxed pt-1">{recording.summary}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer helper / error */}
      <div className="px-4 py-2.5 border-t border-rule">
        {err && <p className="text-[12px] text-urgent mb-1">{err}</p>}
        <p className="text-[11px] text-ink-subtle">
          Mic required — no phone number, no dialing anyone. Nothing is saved unless you click
          &ldquo;Save to history&rdquo; (keeps it for the team); &ldquo;Download .txt&rdquo; grabs a local copy.
        </p>
      </div>
    </div>
  );
}
