/**
 * calls/CallViewer.tsx — one AI call: play the recording, read the transcript, download both (19 Nov 2026).
 *
 * Inputs:  callId (call_attempts id); loads /api/calls/:id and, when ready, /api/calls/:id/recording
 * Outputs: a modal; downloads happen in the browser (the transcript .txt is built from the loaded call)
 * Used by: components/calls/CallLogsClient.tsx, components/crm/CrmLeadPanel.tsx
 *
 * Dumb client: the labels and the recording message come from the server (lib/calls/call-logs.ts).
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { downloadName, transcriptTxt } from "@/lib/calls/recordings";

interface CallDetail {
  id: string;
  leadId: string;
  business: string;
  createdAt: string;
  endedAt: string | null;
  phone: string | null;
  isTest: boolean;
  agent: string;
  result: string;
  durationSec: number | null;
  hasTranscript: boolean;
  recording: { kind: "ready" | "pending" | "none"; text: string };
  transcript: string | null;
}

function length(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function CallViewer({ callId, onClose }: { callId: string; onClose: () => void }) {
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetchJson<CallDetail>(`/api/calls/${callId}`);
      if (!live) return;
      if (!r.success) return setError(r.error);
      setCall(r.data);
      if (r.data.recording.kind === "ready") {
        const l = await fetchJson<{ url: string }>(`/api/calls/${callId}/recording`);
        if (live && l.success) setAudio(l.data.url);
      }
    })();
    return () => {
      live = false;
    };
  }, [callId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function downloadRecording() {
    const l = await fetchJson<{ url: string }>(`/api/calls/${callId}/recording?download=1`);
    if (!l.success) return void toast.error(l.error);
    window.location.assign(l.data.url);
  }

  function downloadTranscript() {
    if (!call) return;
    const text = transcriptTxt({ business: call.business, date: call.createdAt, phone: call.phone, agent: call.agent, result: call.result, durationSec: call.durationSec, transcript: call.transcript });
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName(call.business, call.createdAt, "txt");
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label="AI call" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-rule px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">
              {call ? (
                <Link href={`/leads/${call.leadId}`} className="hover:underline">
                  {call.business}
                </Link>
              ) : (
                "AI call"
              )}
            </h2>
            {call && (
              <p className="text-[12px] text-ink-muted">
                {new Date(call.createdAt).toLocaleString()} · {call.phone ?? "—"}
                {call.isTest && <span className="ml-1.5 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">test number</span>}
                {" · "}Agent: {call.agent} · {call.result} · {length(call.durationSec)}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {error && <p className="text-[13px] text-urgent">{error}</p>}
          {!call && !error && (
            <p className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
          {call && (
            <>
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Recording</h3>
                {call.recording.kind === "ready" ? (
                  audio ? <audio controls src={audio} className="w-full" /> : <p className="text-[12px] text-ink-muted">Loading the recording…</p>
                ) : (
                  <p className="text-[12px] text-ink-muted">{call.recording.text}</p>
                )}
              </section>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={downloadRecording} disabled={call.recording.kind !== "ready"}>
                  <Download className="h-3.5 w-3.5" /> Download recording
                </Button>
                <Button size="sm" variant="ghost" onClick={downloadTranscript}>
                  <FileText className="h-3.5 w-3.5" /> Download transcript (.txt)
                </Button>
              </div>
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Transcript</h3>
                <pre className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-rule bg-surface-alt p-3 font-sans text-[13px] leading-relaxed text-ink">
                  {call.transcript?.trim() || "No transcript for this call."}
                </pre>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
