/**
 * brain/Composer.tsx — the Brain's message box, like a chat app: type or speak the job, attach files, send
 * (27 Nov 2026, spec docs/superpowers/specs/2026-11-27-brain-composer-design.md).
 *
 * Inputs:  sending (busy), placeholder, text + onText (held by the page so its examples can fill the box); the operator's files (+ or drag & drop) and voice (Chrome's Google speech
 *          via components/assistant/useSpeech.ts, English / Hebrew)
 * Outputs: onSend(command, files) — nothing is sent by speaking alone; the words land in the box to edit
 * Used by: components/brain/BrainClient.tsx
 *
 * Dumb: the file rules (kinds, limits) come from lib/brain/attachments.ts and are checked again on the server.
 */
"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, FileText, Mic, MicOff, Plus, Send, X } from "lucide-react";
import { cx } from "@/lib/cx";
import { ACCEPT, checkFiles, fileKind } from "@/lib/brain/attachments";
import { useSpeech } from "@/components/assistant/useSpeech";

const LANGS = [
  { code: "en-US", label: "EN" },
  { code: "he-IL", label: "HE" },
];

export function Composer({
  sending,
  placeholder,
  text,
  onText: setText,
  onSend,
}: {
  sending: boolean;
  placeholder: string;
  text: string;
  onText: (text: string) => void;
  onSend: (command: string, files: File[]) => boolean | Promise<boolean>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [lang, setLang] = useState("en-US");
  const [interim, setInterim] = useState("");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // What was in the box when the mic started: spoken words are added after it.
  const base = useRef("");
  const speech = useSpeech(lang, (finalText, interimText) => {
    setText(`${base.current}${base.current && finalText ? " " : ""}${finalText}`.slice(0, 500));
    setInterim(interimText);
  });

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const add = (list: FileList | File[]) => {
    const next = [...files, ...Array.from(list)];
    const check = checkFiles(next.map((f) => ({ name: f.name, size: f.size })));
    if (!check.ok) return void setProblem(check.message);
    setProblem(null);
    setFiles(next);
  };

  // The box is cleared only when the page says the message went through: a refused message stays to fix.
  const send = async () => {
    if (sending) return;
    if (speech.listening) speech.stop();
    const command = text.trim();
    if (command.length < 3 && !files.length) return;
    setInterim("");
    if (!(await onSend(command, files))) return;
    setText("");
    setFiles([]);
    setProblem(null);
    requestAnimationFrame(grow);
  };

  const toggleMic = () => {
    if (speech.listening) return speech.stop();
    base.current = text.trim();
    speech.start();
  };

  return (
    <div
      className={cx("rounded-xl border bg-white shadow-sm transition-colors", dragging ? "border-action ring-2 ring-action/20" : "border-rule-strong")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) add(e.dataTransfer.files);
      }}
    >
      <textarea
        ref={area}
        id="brain-command"
        value={text}
        rows={2}
        maxLength={500}
        disabled={sending}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          grow();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        className="block w-full resize-none rounded-t-xl bg-transparent px-4 pt-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle"
      />
      {interim && <p className="px-4 text-[13px] italic text-ink-subtle">{interim}…</p>}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-rule bg-surface-alt px-2 py-1 text-[12px] text-ink">
              {fileKind(f.name) === "list" ? <FileSpreadsheet className="h-3.5 w-3.5 text-positive" aria-hidden /> : <FileText className="h-3.5 w-3.5 text-action" aria-hidden />}
              <span className="max-w-[180px] truncate">{f.name}</span>
              <span className="text-ink-subtle">{fileKind(f.name) === "list" ? "list" : "brief"}</span>
              <button type="button" aria-label={`Remove ${f.name}`} className="text-ink-subtle hover:text-ink" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={sending}
            title="Attach a list (CSV / Excel) or a brief (PDF, Word, text, image)"
            aria-label="Attach files"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-surface-alt hover:text-ink"
          >
            <Plus className="h-5 w-5" strokeWidth={2} />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <div className="flex items-center gap-1">
          {speech.supported && (
            <>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                disabled={speech.listening}
                aria-label="Voice language"
                className="h-8 rounded-md border border-rule bg-white px-1 text-[11px] text-ink-muted"
              >
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={toggleMic}
                disabled={sending}
                title={speech.listening ? "Stop listening" : "Speak the job (Chrome's voice typing)"}
                aria-label={speech.listening ? "Stop listening" : "Speak"}
                className={cx(
                  "flex h-9 w-9 items-center justify-center rounded-full",
                  speech.listening ? "bg-urgent text-white animate-pulse" : "text-ink-muted hover:bg-surface-alt hover:text-ink",
                )}
              >
                {speech.listening ? <MicOff className="h-4.5 w-4.5" strokeWidth={2} /> : <Mic className="h-4.5 w-4.5" strokeWidth={2} />}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || (text.trim().length < 3 && !files.length)}
            aria-label="Send"
            title="Send (Enter). Shift+Enter for a new line."
            className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white hover:opacity-90 disabled:opacity-30"
          >
            <Send className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
      {(problem || speech.error) && <p className="px-4 pb-2 text-[12px] text-urgent">{problem ?? speech.error}</p>}
    </div>
  );
}
