/**
 * outreach/VoiceTestModal.tsx — "Test voice agent" on a lead: talk to the Voizo agent from the browser, with this
 * lead's details, like Script Builder's test call. No phone number is dialled (20 Nov 2026).
 *
 * Inputs:  leadId; GET /api/leads/:id/voice-test (what the agent is told), POST (a single-use Voizo test session)
 * Outputs: a live browser call through Vapi (@vapi-ai/web, loaded only when Start is pressed) + the live transcript
 * Used by: components/leads/ContactCard.tsx, components/LeadsTable.tsx
 *
 * Dumb client: the session's assistantOverrides are passed to Vapi UNCHANGED (their metadata is how Voizo fills the
 * script's tokens for this call).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, PhoneOff, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { isNormalCallEnd, missingScriptVariables, offerWords, voiceErrorText } from "@/lib/calls/voice-test";

interface Preview {
  configured: boolean;
  businessName: string;
  greeting: string | null;
  baseVariables: Vars;
  offers: { key: string; label: string; campaignId: string | null; scriptVariables: string[] | null }[];
  offerKey: string | null;
}
type Vars = Partial<Record<"business" | "category" | "offer" | "event" | "booth" | "city" | "site" | "rating" | "reviews", string>>;
interface Session {
  publicKey: string;
  assistantId: string;
  assistantOverrides: Record<string, unknown>;
  sessionId: string;
}
type Phase = "idle" | "starting" | "live" | "ended";
interface Line {
  role: string;
  text: string;
}

const INPUT = "w-full px-3 py-2 text-[13px] border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none";
const LABELS: [keyof Vars, string][] = [
  ["business", "Business"],
  ["category", "Type"],
  ["offer", "What we sell"],
  ["event", "Show"],
  ["booth", "Stand"],
  ["city", "City"],
  ["site", "Review site"],
  ["rating", "Rating"],
  ["reviews", "Reviews"],
];

export function VoiceTestModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [offer, setOffer] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const vapiRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    fetchJson<Preview>(`/api/leads/${leadId}/voice-test`).then((r) => {
      if (!r.success) return setLoadError(r.error);
      setPreview(r.data);
      setName(r.data.greeting ?? "");
      setOffer(r.data.offerKey ?? "");
    });
  }, [leadId]);

  // Hang up when the window closes.
  useEffect(() => () => vapiRef.current?.stop(), []);

  function close() {
    vapiRef.current?.stop();
    onClose();
  }

  async function start() {
    setError(null);
    setLines([]);
    setPhase("starting");
    const r = await fetchJson<Session>(`/api/leads/${leadId}/voice-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ greeting_name: name.trim() || null, offer: offer || null }),
    });
    if (!r.success) {
      setError(r.error);
      setPhase("idle");
      return;
    }
    try {
      // Browser-only library: loaded here, never during server rendering.
      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(r.data.publicKey);
      vapiRef.current = vapi;
      vapi.on("call-start", () => setPhase("live"));
      vapi.on("call-end", () => {
        setPhase("ended");
        setSpeaking(false);
      });
      vapi.on("speech-start", () => setSpeaking(true));
      vapi.on("speech-end", () => setSpeaking(false));
      vapi.on("message", (m: { type?: string; transcriptType?: string; role?: string; transcript?: string }) => {
        if (m.type === "transcript" && m.transcriptType === "final" && m.transcript) {
          setLines((ls) => [...ls, { role: m.role === "assistant" ? "Agent" : "You", text: m.transcript! }]);
        }
      });
      vapi.on("error", (e: unknown) => {
        // The agent hanging up comes as an "error" ("meeting has ended"): show it as a normal end.
        if (!isNormalCallEnd(e)) setError(voiceErrorText(e));
        setPhase("ended");
        setSpeaking(false);
      });
      const startCall = vapi.start as unknown as (assistantId: string, overrides: Record<string, unknown>) => Promise<unknown>;
      await startCall.call(vapi, r.data.assistantId, r.data.assistantOverrides);
    } catch (e) {
      setError(voiceErrorText(e));
      setPhase("idle");
    }
  }

  function end() {
    vapiRef.current?.stop();
    setPhase("ended");
  }

  const live = phase === "live" || phase === "starting";
  // The picked offer's script, what the agent is told, and the script's tokens this lead can't fill.
  const script = preview?.offers.find((o) => o.key === offer) ?? null;
  const vars: Vars = preview ? { ...preview.baseVariables, ...(offerWords(offer) ? { offer: offerWords(offer) } : {}) } : {};
  const missing = preview ? missingScriptVariables(script?.scriptVariables ?? null, vars, name.trim() || null) : null;
  // Only show the details this script actually uses (when Voizo told us which).
  const shown = LABELS.filter(([k]) => vars[k] && (!script?.scriptVariables || script.scriptVariables.includes(k)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div role="dialog" aria-label="Test voice agent" className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-rule px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">Test the voice agent{preview ? ` — ${preview.businessName}` : ""}</h2>
            <p className="text-[12px] text-ink-muted">
              Talk to the voice agent from your browser (microphone). No phone number is dialled.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-ink-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {loadError && <p className="text-[13px] text-urgent">{loadError}</p>}
          {!preview && !loadError && (
            <p className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}

          {preview && (
            <>
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">What the agent is told</h3>
                <label className="block">
                  <span className="block text-[11px] text-ink-muted mb-0.5">What are you offering?</span>
                  <select value={offer} onChange={(e) => setOffer(e.target.value)} className={INPUT} disabled={live} aria-label="What are you offering?">
                    {preview.offers.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[11px] text-ink-muted mb-0.5">Name it greets</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="No name" maxLength={40} className={INPUT} disabled={live} />
                </label>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[13px]">
                  {shown.map(([k, label]) => (
                    <div key={k} className="contents">
                      <dt className="text-ink-muted">{label}</dt>
                      <dd className="text-ink">{vars[k]}</dd>
                    </div>
                  ))}
                </dl>
                {missing && missing.length > 0 && (
                  <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-ink">
                    This script also uses {missing.map((t) => `{{${t}}}`).join(", ")}, which this lead doesn&rsquo;t have. The agent will skip those words.
                  </p>
                )}
              </section>

              <div className="flex flex-wrap items-center gap-3">
                {phase === "live" || phase === "starting" ? (
                  <Button variant="secondary" onClick={end}>
                    <PhoneOff className="h-4 w-4" /> End call
                  </Button>
                ) : (
                  <Button onClick={start} disabled={!preview.configured}>
                    <Mic className="h-4 w-4" /> {phase === "ended" ? "Start again" : "Start test call"}
                  </Button>
                )}
                <span className="text-[12px] text-ink-muted">
                  {phase === "starting" && "Connecting… allow the microphone if asked."}
                  {phase === "live" && (speaking ? "Agent is speaking…" : "Live — talk now.")}
                  {phase === "ended" && "Call ended."}
                  {phase === "idle" && !preview.configured && "AI calling isn't connected (no Voizo key)."}
                </span>
              </div>
              {error && <p className="text-[13px] text-urgent">{error}</p>}

              {lines.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Conversation</h3>
                  <div className="max-h-[35vh] overflow-y-auto rounded-lg border border-rule bg-surface-alt p-3 space-y-1.5">
                    {lines.map((l, i) => (
                      <p key={i} className="text-[13px] text-ink">
                        <span className="font-semibold">{l.role}:</span> {l.text}
                      </p>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
