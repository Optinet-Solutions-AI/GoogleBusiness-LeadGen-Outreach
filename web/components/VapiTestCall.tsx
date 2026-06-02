"use client";

/**
 * VapiTestCall.tsx — in-browser "Test call" to a Vapi assistant.
 *
 * Mic-based web call (no phone number, no telephony) so you can test the live agent's
 * script + voice from anywhere — including outside the US. Uses the Vapi WEB SDK with the
 * PUBLIC key (client-safe). The SDK is dynamically imported inside an effect so it never
 * runs during SSR (it touches browser-only WebRTC globals).
 *
 * Env (NEXT_PUBLIC, baked at build time): NEXT_PUBLIC_VAPI_PUBLIC_KEY + NEXT_PUBLIC_VAPI_TEST_ASSISTANT_ID.
 */

import { useEffect, useRef, useState } from "react";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_TEST_ASSISTANT_ID;

type Status = "idle" | "connecting" | "live" | "ended" | "error";
interface Line {
  role: string;
  text: string;
}

export function VapiTestCall() {
  const vapiRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);

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
      try {
        vapiRef.current?.stop?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

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
    setStatus("connecting");
    try {
      await vapiRef.current?.start(ASSISTANT_ID);
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
  };

  const statusLabel: Record<Status, string> = {
    idle: "Idle",
    connecting: "Connecting…",
    live: speaking ? "Agent speaking…" : "Listening…",
    ended: "Call ended",
    error: "Error",
  };
  const dot =
    status === "live" ? "bg-positive" : status === "connecting" ? "bg-warning" : status === "error" ? "bg-urgent" : "bg-ink-subtle";

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-rule rounded-lg p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${dot} ${status === "live" ? "animate-pulse" : ""}`} />
            <span className="text-[13px] text-ink-muted">{statusLabel[status]}</span>
          </div>
          {inCall ? (
            <button
              onClick={stop}
              className="px-4 py-2 rounded bg-urgent text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
            >
              End call
            </button>
          ) : (
            <button
              onClick={start}
              disabled={!ready}
              className="px-4 py-2 rounded bg-action text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {ready ? "Start test call" : "Loading…"}
            </button>
          )}
        </div>
        {err && <p className="mt-3 text-[12px] text-urgent">{err}</p>}
        <p className="mt-3 text-[11.5px] text-ink-subtle">
          Talks to the assistant in your browser (mic required) — no phone number, no dialing anyone.
          The browser will ask for microphone permission on the first call.
        </p>
      </div>

      <div className="bg-surface border border-rule rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-rule">
          <h2 className="eyebrow">Live transcript</h2>
        </div>
        {lines.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-ink-muted">
            Start a call to see the transcript here.
          </p>
        ) : (
          <ul className="divide-y divide-rule">
            {lines.map((l, i) => (
              <li key={i} className="px-4 py-2.5">
                <span
                  className={`text-label-caps uppercase tracking-[0.14em] mr-2 ${
                    l.role === "assistant" ? "text-action" : "text-ink-subtle"
                  }`}
                >
                  {l.role === "assistant" ? "Agent" : l.role === "user" ? "You" : l.role}
                </span>
                <span className="text-[13px] text-ink">{l.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
