/**
 * leads/AiProfileModal.tsx — the "AI profile" window: a short summary + bullet list of what OpenAI found about a lead.
 *
 * Inputs:  lead id + name; GET /api/leads/:id/ai-profile (last saved profile, free)
 * Outputs: POST /api/leads/:id/ai-profile on "Search with AI" / "Search again" (about 2–5 cents, 10–50 s)
 * Used by: components/leads/ContactCard.tsx ("AI profile" button)
 *
 * Dumb client: the bullets come from lib/leads/ai-profile-view.ts (pure); the search and saving live in
 * lib/leads/ai-profile.ts.
 */
"use client";

import { useEffect, useState } from "react";
import { Bot, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { profileBullets, type ProfileView } from "@/lib/leads/ai-profile-view";

type Saved = { profile: ProfileView; createdAt: string };
type RunResult = Saved & { filled: string[]; saved: boolean };

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AiProfileModal({ leadId, businessName, onClose, onDone }: { leadId: string; businessName: string; onClose: () => void; onDone?: () => void }) {
  const [data, setData] = useState<Saved | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchJson<Saved | null>(`/api/leads/${leadId}/ai-profile`).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (res.success && res.data) setData(res.data);
    });
    return () => {
      alive = false;
    };
  }, [leadId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !running && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    setNote(null);
    const res = await fetchJson<RunResult>(`/api/leads/${leadId}/ai-profile`, { method: "POST" });
    setRunning(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setData(res.data);
    const bits: string[] = [];
    if (res.data.filled.length) bits.push(`Added to the lead: ${res.data.filled.join(", ")}.`);
    if (!res.data.saved) bits.push("Not saved for next time (database update 061 pending).");
    setNote(bits.join(" ") || null);
    if (res.data.filled.length) onDone?.();
  }

  const p = data?.profile ?? null;
  const bullets = p ? profileBullets(p) : [];
  const nothing = p && !p.summary && bullets.length === 0;

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-end sm:items-center justify-center sm:p-4" onClick={() => !running && onClose()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AI profile"
        className="bg-white w-full sm:max-w-[600px] max-h-[94vh] flex flex-col rounded-t-xl sm:rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-rule">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">AI profile · {businessName}</h2>
            <p className="text-[12px] text-ink-muted">What OpenAI web search found on public pages, with the sources.</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{error}</div>}
          {note && <div className="rounded-lg border border-positive/30 bg-positive-soft px-3 py-2 text-[12px] text-ink">{note}</div>}
          {loading && <p className="text-[13px] text-ink-muted">Loading…</p>}
          {running && <p className="text-[13px] text-ink-muted">Searching the web and their site… this takes up to a minute.</p>}

          {!loading && !running && !p && (
            <p className="text-[13px] text-ink">
              No AI profile yet. <span className="text-ink-muted">Search with AI looks this business up (their site, Google, social pages) and lists the owner, contacts, services and more. About 2–5 cents.</span>
            </p>
          )}

          {p && !running && (
            <>
              <p className="text-[11px] text-ink-subtle">Made {when(data!.createdAt)}</p>
              {nothing && <p className="text-[13px] text-ink">Nothing public found for this business.</p>}
              {p.summary && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted font-mono mb-1">Summary</p>
                  <p className="text-[13px] text-ink leading-relaxed">{p.summary}</p>
                </div>
              )}
              {bullets.length > 0 && (
                <ul className="space-y-1.5 text-[13px]">
                  {bullets.map((b) => (
                    <li key={b.label} className="flex gap-2">
                      <span className="text-ink-subtle">•</span>
                      <span className="min-w-0">
                        <span className="font-semibold text-ink">{b.label}:</span>{" "}
                        {b.text && <span className="text-ink break-words">{b.text}</span>}
                        {b.links?.map((l, i) => (
                          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-action hover:underline break-all">
                            {i > 0 ? ", " : ""}
                            {l.label}
                          </a>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {p.sources.length > 0 && (
                <details className="text-[12px]">
                  <summary className="cursor-pointer text-ink-muted">Sources ({p.sources.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {p.sources.map((s) => (
                      <li key={s}>
                        <a href={s} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-action hover:underline break-all">
                          {s.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3 flex-none" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-rule flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink-muted min-w-0 flex-1">Fills the lead&rsquo;s email, phone or owner only when empty. A note goes on the CRM timeline.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={running}>Close</Button>
            <Button onClick={run} loading={running} disabled={loading}>
              <Bot strokeWidth={2} /> {p ? "Search again" : "Search with AI"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
