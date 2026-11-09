/**
 * assistant/AssistantWidget.tsx — the "Ask" button + chat panel on every dashboard page.
 *
 * Inputs:  GET /api/assistant (is it switched on?), POST /api/assistant (one question); the current path
 * Outputs: a floating panel: suggested questions, the chat, a text box, a mic (English / Hebrew) and Send
 * Used by: app/(dashboard)/layout.tsx
 *
 * Dumb client: it only shows the chat and calls the API. Answers are English small-markdown, rendered through
 * lib/assistant/format.ts (no raw HTML; only in-app links are clickable). The chat survives page changes because
 * the dashboard layout stays mounted. The voice language choice is remembered in this browser.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, Mic, MicOff, Send, Sparkles, Trash2, X } from "lucide-react";
import { SUGGESTED_QUESTIONS } from "@/lib/assistant/knowledge";
import { parseAnswerBlocks, type Inline } from "@/lib/assistant/format";
import { useSpeech } from "./useSpeech";

type Turn = { role: "user" | "assistant"; text: string; error?: boolean };

const LANGS = [
  { code: "en-US", short: "EN", label: "English" },
  { code: "he-IL", short: "עב", label: "Hebrew (עברית)" },
] as const;
const LANG_KEY = "rateup.assistant.voiceLang";

function readLang(): string {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return LANGS.some((l) => l.code === v) ? (v as string) : "en-US";
  } catch {
    return "en-US";
  }
}

function InlineView({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.t === "b" ? (
          <strong key={i} className="font-semibold text-ink">{p.v}</strong>
        ) : p.t === "code" ? (
          <code key={i} className="rounded bg-surface-alt px-1 text-[12px]">{p.v}</code>
        ) : p.t === "link" ? (
          <Link key={i} href={p.href} className="font-medium text-action underline underline-offset-2">{p.v}</Link>
        ) : (
          <span key={i}>{p.v}</span>
        ),
      )}
    </>
  );
}

function AnswerView({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseAnswerBlocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>
            {b.items.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <InlineView parts={line} />
              </span>
            ))}
          </p>
        ) : b.kind === "ol" ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {b.items.map((line, j) => <li key={j}><InlineView parts={line} /></li>)}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((line, j) => <li key={j}><InlineView parts={line} /></li>)}
          </ul>
        ),
      )}
    </div>
  );
}

export function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<string>("en-US");
  const [micBlocked, setMicBlocked] = useState(false);
  const baseText = useRef("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const speech = useSpeech(lang, (finalText, interim) => {
    const spoken = [finalText, interim].filter(Boolean).join(" ");
    setInput([baseText.current, spoken].filter(Boolean).join(baseText.current ? " " : ""));
  });

  useEffect(() => setLang(readLang()), []);

  // Is the assistant switched on (OpenAI key present)? Checked when the panel first opens.
  useEffect(() => {
    if (!open || configured !== null) return;
    fetch("/api/assistant")
      .then((r) => r.json())
      .then((j) => setConfigured(Boolean(j?.data?.configured)))
      .catch(() => setConfigured(false));
  }, [open, configured]);

  // Show a hint up front if Chrome has the microphone blocked for this site.
  useEffect(() => {
    if (!open || typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((s) => {
        status = s;
        setMicBlocked(s.state === "denied");
        s.onchange = () => setMicBlocked(s.state === "denied");
      })
      .catch(() => {});
    return () => {
      if (status) status.onchange = null;
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      if (speech.listening) speech.stop();
      const history = turns.filter((t) => !t.error).map(({ role, text }) => ({ role, text }));
      setTurns((t) => [...t, { role: "user", text: q }]);
      setInput("");
      baseText.current = "";
      setBusy(true);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, history, page: pathname ?? "/" }),
        });
        const j = await res.json().catch(() => null);
        if (j?.success) setTurns((t) => [...t, { role: "assistant", text: j.data.answer }]);
        else setTurns((t) => [...t, { role: "assistant", text: j?.error ?? "Something went wrong. Try again.", error: true }]);
      } catch {
        setTurns((t) => [...t, { role: "assistant", text: "Couldn't reach the assistant. Check your connection.", error: true }]);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, pathname, speech, turns],
  );

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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[90] flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-[13px] font-semibold text-canvas shadow-[0_10px_28px_-10px_rgba(17,17,15,0.45)] transition hover:opacity-90"
        aria-label="Open the app assistant"
      >
        <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
        Ask how
      </button>
    );
  }

  const off = configured === false;
  const micTitle = !speech.supported
    ? "Voice typing works in Chrome or Edge"
    : speech.listening
      ? "Stop listening"
      : `Speak (${LANGS.find((l) => l.code === lang)?.label})`;

  return (
    <section
      className="card fixed bottom-5 right-5 z-[90] flex h-[min(620px,calc(100vh-6rem))] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden shadow-[0_18px_48px_-16px_rgba(17,17,15,0.45)]"
      aria-label="App assistant"
    >
      <header className="flex items-center gap-2 border-b border-rule px-4 py-3">
        <Sparkles className="h-4 w-4 text-action" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">App assistant</p>
          <p className="text-[11px] text-ink-muted">How to use RateUp — ask in English or Hebrew, answers in English</p>
        </div>
        {turns.length > 0 && (
          <button type="button" onClick={() => setTurns([])} className="rounded p-1.5 text-ink-subtle hover:bg-surface-alt hover:text-ink" aria-label="Clear the chat" title="Clear the chat">
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1.5 text-ink-subtle hover:bg-surface-alt hover:text-ink" aria-label="Close the assistant">
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
        {off && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-ink">
            The assistant is ready but not switched on yet. It starts working as soon as an OpenAI API key
            (<code>OPENAI_API_KEY</code>) is added in Vercel.
          </div>
        )}
        {turns.length === 0 && (
          <div className="space-y-2">
            <p>Ask me how to do anything in the app. Try one of these:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={off || busy}
                  onClick={() => ask(q)}
                  className="rounded-full border border-rule bg-surface px-2.5 py-1 text-left text-[12px] text-ink hover:border-rule-strong hover:bg-surface-alt disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-8 rounded-lg bg-surface-alt px-3 py-2 text-ink" dir="auto">
              {t.text}
            </div>
          ) : (
            <div key={i} className={t.error ? "rounded-lg bg-urgent-soft px-3 py-2 text-urgent" : "pr-4"}>
              {t.error ? t.text : <AnswerView text={t.text} />}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-ink-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Thinking…
          </div>
        )}
      </div>

      <footer className="border-t border-rule px-3 py-3">
        {(speech.error || micBlocked) && (
          <p className="mb-2 text-[11px] leading-snug text-urgent">
            {speech.error ??
              "The microphone is blocked for this site. Click the icon left of the web address → Microphone → Allow, then reload."}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            dir="auto"
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            placeholder={speech.listening ? "Listening… speak now" : "Type or speak your question"}
            disabled={off}
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-rule bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-subtle focus:border-action focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={toggleMic}
            disabled={!speech.supported || off}
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
            disabled={!input.trim() || busy || off}
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
              className={
                lang === l.code
                  ? "rounded bg-ink px-1.5 py-0.5 font-semibold text-canvas"
                  : "rounded border border-rule px-1.5 py-0.5 text-ink-muted hover:bg-surface-alt"
              }
            >
              {l.short}
            </button>
          ))}
          <span className="ml-auto">Google speech · Chrome</span>
        </div>
      </footer>
    </section>
  );
}
