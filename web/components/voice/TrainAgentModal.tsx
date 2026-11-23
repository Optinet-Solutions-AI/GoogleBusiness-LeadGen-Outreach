/**
 * voice/TrainAgentModal.tsx — "Train the voice agent": one box where the operator says (types or speaks) what to
 * change; the agent answers, shows the lines it would change (now → new), and the change is saved on a click.
 *
 * Inputs:  optionally the Voizo campaign id + label of the offer to train (else the operator picks one);
 *          GET /api/voice-training (trainable agents) · GET ?campaignId= (recent changes)
 * Outputs: POST /api/voice-training { action: "ask" | "apply" | "undo", … }
 * Used by: components/outreach/VoiceTestModal.tsx ("Train this agent"), components/voice/VoiceAgentsClient.tsx
 *
 * Dumb client: the script lives in Voizo and every rule (wording only, known {{tokens}}, lines shared with other
 * Voizo campaigns refused) is enforced there; refusals arrive as plain sentences. The standing answers (who's
 * calling, not interested, do not call, scam worries) are ONE set for all the offers' agents: Voizo's reply says so
 * (a `sharedAcrossOffers` flag on the proposal, and "Heads up: …" in the reply) and the window shows a warning above the change. Voice typing = Chrome's Google speech
 * (useSpeech), EN / Hebrew, sharing the "Ask how" assistant's remembered language. Nothing changes until "Save change".
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Mic, MicOff, Send, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";
import { useSpeech } from "@/components/assistant/useSpeech";
import { asLines, groupEdits, historyTurns, sharedWarning, type TrainChange, type TrainProposal, type TrainableAgent } from "@/lib/calls/train-agent-view";

type Turn = {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  /** Voizo's "this changes it for every offer" sentence, shown as a warning above the change. */
  warning?: string | null;
  proposal?: TrainProposal | null;
  /** What happened to the proposal: saved (with its change id), discarded, or undone after saving. */
  state?: "saved" | "discarded" | "undone";
  changeId?: string;
};

const LANGS = [
  { code: "en-US", short: "EN", label: "English" },
  { code: "he-IL", short: "עב", label: "Hebrew (עברית)" },
] as const;
const LANG_KEY = "rateup.assistant.voiceLang";
const EXAMPLES = ["Don't mention price on the first call", "Make the opening shorter and friendlier", "If they ask who we are, say we're a small web studio"];
const INPUT =
  "w-full px-3 text-[13px] text-ink border border-rule-strong rounded-md bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none disabled:bg-surface-alt";

function readLang(): string {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return LANGS.some((l) => l.code === v) ? (v as string) : "en-US";
  } catch {
    return "en-US";
  }
}

function Lines({ value, tone }: { value: string | string[]; tone: "old" | "new" }) {
  return (
    <ul className={cx("space-y-1 rounded-md px-2.5 py-1.5 text-[12px] leading-relaxed", tone === "old" ? "bg-surface-alt text-ink-muted line-through decoration-ink-subtle/50" : "bg-positive-soft text-ink")}>
      {asLines(value).map((l, i) => (
        <li key={i} dir="auto">{l}</li>
      ))}
    </ul>
  );
}

function ProposalCard({ p }: { p: TrainProposal }) {
  return (
    <div className="mt-2 space-y-3">
      {groupEdits(p.edits).map((e, i) => (
        <div key={i} className="space-y-1">
          <p className="text-[11px] font-semibold text-ink-muted">{e.title}</p>
          {e.places.length > 0 && (
            <p className="text-[11px] text-ink-subtle">
              Said in {e.places.length} parts of the call: {e.places.join(" · ")}
            </p>
          )}
          <p className="text-[10px] uppercase tracking-wide text-ink-subtle">Says now</p>
          <Lines value={e.before} tone="old" />
          <p className="text-[10px] uppercase tracking-wide text-ink-subtle">Will say</p>
          <Lines value={e.after} tone="new" />
        </div>
      ))}
    </div>
  );
}

export function TrainAgentModal({ campaignId, label, onClose }: { campaignId?: string | null; label?: string | null; onClose: () => void }) {
  const [agents, setAgents] = useState<TrainableAgent[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<string>(campaignId ?? "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [changes, setChanges] = useState<TrainChange[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lang, setLang] = useState<string>("en-US");
  const baseText = useRef("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const speech = useSpeech(lang, (finalText, interim) => {
    const spoken = [finalText, interim].filter(Boolean).join(" ");
    setInput([baseText.current, spoken].filter(Boolean).join(baseText.current ? " " : ""));
  });

  useEffect(() => setLang(readLang()), []);

  // Which agents can be trained (also tells us if Voizo is connected at all).
  useEffect(() => {
    let alive = true;
    fetchJson<{ configured: boolean; agents: TrainableAgent[]; note?: string }>("/api/voice-training").then((r) => {
      if (!alive) return;
      if (!r.success) {
        setAgents([]);
        setNote(r.error);
        return;
      }
      setAgents(r.data.agents);
      setNote(r.data.note ?? null);
      setPicked((cur) => cur || (r.data.agents.length === 1 ? r.data.agents[0].campaignId : ""));
    });
    return () => {
      alive = false;
    };
  }, []);

  const loadChanges = useCallback(async (id: string) => {
    const r = await fetchJson<{ changes: TrainChange[] }>(`/api/voice-training?campaignId=${encodeURIComponent(id)}`);
    setChanges(r.success ? r.data.changes : []);
  }, []);

  // A different agent = a fresh conversation.
  useEffect(() => {
    setTurns([]);
    setChanges([]);
    if (picked) void loadChanges(picked);
  }, [picked, loadChanges]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const post = (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>("/api/voice-training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId: picked, ...body }),
    });

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy || !picked || off) return;
    if (speech.listening) speech.stop();
    const history = historyTurns(turns.map((t) => ({ role: t.role, text: t.text, error: t.error, warning: t.warning, hasProposal: !!t.proposal, state: t.state })));
    setTurns((t) => [...t, { role: "user", text: q }]);
    setInput("");
    baseText.current = "";
    setBusy(true);
    const r = await post({ action: "ask", message: q, history });
    setBusy(false);
    if (!r.success) setTurns((t) => [...t, { role: "assistant", text: r.error, error: true }]);
    else {
      const proposal = (r.data.proposal as TrainProposal | null) ?? null;
      const said = sharedWarning(String(r.data.reply ?? ""), proposal);
      setTurns((t) => [...t, { role: "assistant", text: said.text, warning: said.warning, proposal: proposal?.edits.length ? proposal : null }]);
    }
    inputRef.current?.focus();
  }

  const mark = (i: number, patch: Partial<Turn>) => setTurns((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save(i: number, proposalId: string) {
    setActing(proposalId);
    const r = await post({ action: "apply", proposalId });
    setActing(null);
    // No "Not saved" title: Voizo can answer that the change IS live but couldn't be recorded.
    if (!r.success) return void toast.error(r.error);
    mark(i, { state: "saved", changeId: String(r.data.changeId) });
    toast.success("Saved. The agent uses the new wording from its next call. Test it to hear it.");
    void loadChanges(picked);
  }

  async function undo(changeId: string, turnIndex?: number) {
    setActing(changeId);
    const r = await post({ action: "undo", changeId });
    setActing(null);
    if (!r.success) return void toast.error(r.error);
    if (turnIndex != null) mark(turnIndex, { state: "undone" });
    else setTurns((t) => t.map((x) => (x.changeId === changeId ? { ...x, state: "undone" } : x)));
    toast.success("Undone. The agent is back to the earlier wording.");
    void loadChanges(picked);
  }

  const toggleMic = () => {
    if (speech.listening) return speech.stop();
    baseText.current = input.trim();
    speech.start();
  };
  const pickLang = (code: string) => {
    if (speech.listening) speech.stop();
    setLang(code);
    try {
      window.localStorage.setItem(LANG_KEY, code);
    } catch {
      /* private window: just not remembered */
    }
  };

  const unsaved = turns.some((t) => t.proposal && !t.state);
  const close = () => {
    if (unsaved && !window.confirm("Close without saving the suggested change?")) return;
    if (speech.listening) speech.stop();
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const agentLabel = agents?.find((a) => a.campaignId === picked)?.label ?? label ?? null;
  // Voizo marks a script it won't let the API reword; it is then missing from the list of trainable agents.
  const locked = agents !== null && agents.length > 0 && !!picked && !agents.some((a) => a.campaignId === picked);
  const off = locked || (agents !== null && !picked && agents.length === 0);
  const micTitle = !speech.supported ? "Voice typing works in Chrome or Edge" : speech.listening ? "Stop listening" : `Speak (${LANGS.find((l) => l.code === lang)?.label})`;
  const live = changes.filter((c) => !c.undoneAt);

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[70] flex items-end sm:items-center justify-center sm:p-4"
      onClick={(e) => {
        e.stopPropagation();
        close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Train the voice agent"
        className="bg-white w-full sm:max-w-[620px] h-[min(720px,94vh)] flex flex-col rounded-t-xl sm:rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-rule">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">Train the voice agent{agentLabel ? ` · ${agentLabel}` : ""}</h2>
            <p className="text-[12px] text-ink-muted">Say or type what to change. It shows the new wording, and nothing changes until you save.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {note && <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-ink">{note}</div>}
          {agents === null && <p className="text-[13px] text-ink-muted">Loading…</p>}
          {locked && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-ink">
              This agent&rsquo;s wording is locked in Voizo, so it can&rsquo;t be trained from here.
            </div>
          )}

          {agents !== null && !campaignId && agents.length > 1 && (
            <label className="block">
              <span className="block text-[11px] font-semibold text-ink-muted mb-1">Which agent?</span>
              <select value={picked} onChange={(e) => setPicked(e.target.value)} disabled={busy} aria-label="Which agent" className={cx(INPUT, "h-9")}>
                <option value="">Pick the offer it sells…</option>
                {agents.map((a) => (
                  <option key={a.campaignId} value={a.campaignId}>{a.label}</option>
                ))}
              </select>
            </label>
          )}

          {picked && !locked && turns.length === 0 && (
            <div className="rounded-lg border border-rule bg-surface-alt px-3 py-3 text-[12px] text-ink-muted space-y-2">
              <p>Tell it one thing to change. For example:</p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((x) => (
                  <button key={x} type="button" onClick={() => setInput(x)} className="rounded-full border border-rule bg-white px-2.5 py-1 text-[12px] text-ink hover:bg-surface">
                    {x}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-ink-subtle">It can reword what the agent already says. Adding new steps to the call needs Voizo&rsquo;s Script Builder.</p>
              <p className="text-[11px] text-ink-subtle">
                The answers to &ldquo;who&rsquo;s calling?&rdquo;, &ldquo;not interested&rdquo;, &ldquo;don&rsquo;t call me&rdquo; and &ldquo;is this a scam?&rdquo; are shared by
                all the offers&rsquo; agents: change one and it changes for all of them (it warns you first). A line that is also used by other Voizo
                campaigns can&rsquo;t be changed here; it tells you when you ask for one.
              </p>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} className={cx("flex", t.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cx(
                  "max-w-[92%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
                  t.role === "user" ? "bg-ink text-canvas" : t.error ? "border border-urgent/30 bg-urgent-soft text-ink" : "border border-rule bg-surface text-ink",
                )}
              >
                <p dir="auto" className="whitespace-pre-wrap">{t.text}</p>
                {t.warning && (
                  <p role="alert" className="mt-2 rounded-md border border-warning/40 bg-warning-soft px-2.5 py-1.5 text-[12px] font-semibold text-ink">
                    {t.warning}
                  </p>
                )}
                {t.proposal && (
                  <>
                    <ProposalCard p={t.proposal} />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!t.state && (
                        <>
                          <Button size="sm" onClick={() => save(i, t.proposal!.id)} loading={acting === t.proposal.id} disabled={!!acting}>
                            <Check className="h-3.5 w-3.5" /> Save change
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => mark(i, { state: "discarded" })} disabled={!!acting}>
                            Discard
                          </Button>
                        </>
                      )}
                      {t.state === "saved" && (
                        <>
                          <span className="text-[12px] font-semibold text-positive">Saved ✓ live from the next call</span>
                          {t.changeId && (
                            <Button size="sm" variant="ghost" onClick={() => undo(t.changeId!, i)} loading={acting === t.changeId} disabled={!!acting}>
                              <Undo2 className="h-3.5 w-3.5" /> Undo
                            </Button>
                          )}
                        </>
                      )}
                      {t.state === "discarded" && <span className="text-[12px] text-ink-subtle">Discarded. Nothing changed.</span>}
                      {t.state === "undone" && <span className="text-[12px] text-ink-subtle">Undone. Back to the earlier wording.</span>}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          {busy && <p className="text-[12px] text-ink-subtle">Thinking… (up to a minute)</p>}

          {picked && live.length > 0 && (
            <div className="pt-1">
              <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-[12px] text-action hover:underline">
                {showHistory ? "Hide" : "Show"} recent changes ({live.length})
              </button>
              {showHistory && (
                <ul className="mt-2 space-y-2">
                  {live.map((c) => (
                    <li key={c.id} className="rounded-lg border border-rule px-3 py-2 text-[12px] text-ink flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span dir="auto" className="block">{c.instruction || c.summary || "Wording change"}</span>
                        {c.appliedAt && <span className="text-[11px] text-ink-subtle">{new Date(c.appliedAt).toLocaleString()}</span>}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => undo(c.id)} loading={acting === c.id} disabled={!!acting}>
                        <Undo2 className="h-3.5 w-3.5" /> Undo
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-rule">
          {speech.error && <p className="mb-2 text-[11px] text-urgent">{speech.error}</p>}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              dir="auto"
              rows={2}
              maxLength={1000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
              placeholder={!picked ? "Pick an agent first" : speech.listening ? "Listening… speak now" : "Type or speak what to change"}
              disabled={!picked || off}
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-rule bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-subtle focus:border-action focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={toggleMic}
              disabled={!speech.supported || !picked || off}
              title={micTitle}
              aria-label={micTitle}
              aria-pressed={speech.listening}
              className={
                speech.listening
                  ? "flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-urgent text-canvas animate-pulse"
                  : "flex h-[44px] w-[44px] items-center justify-center rounded-lg border border-rule bg-surface text-ink hover:bg-surface-alt disabled:opacity-40"
              }
            >
              {speech.supported ? <Mic className="h-4 w-4" strokeWidth={2} /> : <MicOff className="h-4 w-4" strokeWidth={2} />}
            </button>
            <button
              type="button"
              onClick={() => ask(input)}
              disabled={!input.trim() || busy || !picked || off}
              className="flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-ink text-canvas hover:opacity-90 disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-subtle">
            <span>Voice:</span>
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => pickLang(l.code)}
                aria-pressed={lang === l.code}
                title={l.label}
                className={lang === l.code ? "rounded bg-ink px-1.5 py-0.5 font-semibold text-canvas" : "rounded border border-rule px-1.5 py-0.5 text-ink-muted hover:bg-surface-alt"}
              >
                {l.short}
              </button>
            ))}
            <span className="ml-auto">Google speech · Chrome</span>
          </div>
        </footer>
      </section>
    </div>
  );
}
