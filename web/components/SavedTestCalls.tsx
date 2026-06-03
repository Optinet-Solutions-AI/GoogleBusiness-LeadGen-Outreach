"use client";

/**
 * SavedTestCalls.tsx — In-app history of test-call conversations (everyone using the app sees these).
 *
 * Inputs:  /api/voice/test-calls (GET)
 * Outputs: a list of saved conversations; click one to expand transcript + recording.
 * Used by: app/(dashboard)/test-call/page.tsx
 *
 * Refetches on mount, on a "Refresh" click, and when VapiTestCall fires the `test-call-saved` event.
 */

import { useCallback, useEffect, useState } from "react";

interface Line {
  role: string;
  text: string;
}
interface SavedCall {
  id: string;
  vapi_call_id: string | null;
  transcript: Line[];
  recording_url: string | null;
  summary: string | null;
  duration_seconds: number | null;
  created_at: string;
}

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
function fmtDur(s: number | null): string {
  if (s == null) return "";
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function SavedTestCalls() {
  const [calls, setCalls] = useState<SavedCall[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  // Recording fetched on-demand by vapi_call_id (it's processed by the time you review history).
  const [recMap, setRecMap] = useState<Record<string, { state: "loading" | "ready" | "none"; url?: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/test-calls", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setCalls(json.data?.calls ?? []);
        setState("ready");
      } else {
        setState("unavailable");
      }
    } catch {
      setState("unavailable");
    }
  }, []);

  const fetchRec = useCallback(async (id: string, vapiCallId: string) => {
    setRecMap((m) => ({ ...m, [id]: { state: "loading" } }));
    try {
      const res = await fetch(`/api/voice/call/${vapiCallId}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success && json.data?.recordingUrl) {
        setRecMap((m) => ({ ...m, [id]: { state: "ready", url: json.data.recordingUrl } }));
      } else {
        setRecMap((m) => ({ ...m, [id]: { state: "none" } }));
      }
    } catch {
      setRecMap((m) => ({ ...m, [id]: { state: "none" } }));
    }
  }, []);

  const toggle = (c: SavedCall) => {
    const next = openId === c.id ? null : c.id;
    setOpenId(next);
    if (next && !c.recording_url && c.vapi_call_id && !recMap[c.id]) {
      fetchRec(c.id, c.vapi_call_id);
    }
  };

  useEffect(() => {
    load();
    const onSaved = () => load();
    window.addEventListener("test-call-saved", onSaved);
    return () => window.removeEventListener("test-call-saved", onSaved);
  }, [load]);

  return (
    <div className="bg-surface border border-rule rounded-lg overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-rule flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">History</h2>
          <p className="text-[12px] text-ink-muted mt-0.5">
            Every test call, saved in the app for the whole team — transcript + recording.
          </p>
        </div>
        <button
          onClick={load}
          className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink transition-colors bg-transparent border-0 p-0 cursor-pointer shrink-0"
        >
          Refresh
        </button>
      </div>

      {state === "loading" && (
        <p className="px-5 py-8 text-center text-[13px] text-ink-muted animate-pulse">Loading…</p>
      )}

      {state === "unavailable" && (
        <p className="px-5 py-6 text-[12px] text-ink-subtle">
          History needs the <code className="font-mono text-ink">test_calls</code> table. Apply migration{" "}
          <code className="font-mono text-ink">020_test_calls.sql</code>, then refresh. Until then, calls
          still work — they just aren&apos;t saved.
        </p>
      )}

      {state === "ready" && calls.length === 0 && (
        <p className="px-5 py-8 text-center text-[13px] text-ink-muted">
          No saved calls yet. Run a test call and it&apos;ll show up here.
        </p>
      )}

      {state === "ready" && calls.length > 0 && (
        <ul className="divide-y divide-rule">
          {calls.map((c) => {
            const open = openId === c.id;
            const preview = c.transcript[0]?.text ?? "(no transcript)";
            return (
              <li key={c.id}>
                <button
                  onClick={() => toggle(c)}
                  className="w-full text-left px-5 py-3 hover:bg-canvas/50 transition-colors flex items-center gap-3"
                >
                  <span className="text-[12px] text-ink-muted w-28 shrink-0">{fmtWhen(c.created_at)}</span>
                  <span className="text-[13px] text-ink truncate flex-1">{preview}</span>
                  <span className="text-[11px] text-ink-subtle shrink-0">
                    {c.transcript.length} lines{c.duration_seconds != null ? ` · ${fmtDur(c.duration_seconds)}` : ""}
                  </span>
                  <span className="text-ink-subtle shrink-0 text-[11px]">{open ? "▲" : "▼"}</span>
                </button>

                {open && (
                  <div className="px-5 pb-4 space-y-3">
                    {(() => {
                      const url = c.recording_url ?? recMap[c.id]?.url;
                      const st = c.recording_url ? "ready" : recMap[c.id]?.state;
                      if (url) {
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        return <audio controls src={url} className="w-full h-9" />;
                      }
                      if (st === "loading") return <p className="text-[12px] text-ink-muted animate-pulse">Loading recording…</p>;
                      if (st === "none") return <p className="text-[12px] text-ink-subtle">No recording for this call.</p>;
                      return null;
                    })()}
                    <div className="space-y-2">
                      {c.transcript.map((l, i) => {
                        const isAgent = l.role === "assistant";
                        return (
                          <div key={i} className={`flex ${isAgent ? "justify-start" : "justify-end"}`}>
                            <div
                              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-[1.45] ${
                                isAgent
                                  ? "bg-canvas border border-rule text-ink rounded-tl-sm"
                                  : "bg-action text-white rounded-tr-sm"
                              }`}
                            >
                              {l.text}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {c.summary && <p className="text-[12px] text-ink-muted leading-relaxed">{c.summary}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
