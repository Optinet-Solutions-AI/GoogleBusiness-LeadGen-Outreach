"use client";

/**
 * ComposeModal.tsx — "Compose new" email from the inbox.
 *
 * Inputs:  onClose callback
 * Outputs: lead typeahead (GET /api/inbox/lead-search) → subject + body →
 *          POST /api/inbox/compose (sends a fresh, non-reply email).
 * Used by: InboxClient (Compose button).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Search, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

interface LeadHit {
  id: string;
  business_name: string;
  email: string;
}

export function ComposeModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [lead, setLead] = useState<LeadHit | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // Debounced lead search.
  useEffect(() => {
    if (lead || q.trim().length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await fetchJson<{ leads: LeadHit[] }>(`/api/inbox/lead-search?q=${encodeURIComponent(q.trim())}`);
      if (alive) {
        setHits(res.success ? res.data.leads : []);
        setSearching(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, lead]);

  async function send() {
    if (!lead) return toast.warning("Pick a recipient first.");
    if (!subject.trim()) return toast.warning("Add a subject.");
    if (!body.trim()) return toast.warning("Write a message.");
    setSending(true);
    const res = await fetchJson<{ sent: boolean; via?: string }>("/api/inbox/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: lead.id, subject: subject.trim(), body: body.trim() }),
    });
    setSending(false);
    if (!res.success) return toast.error(res.error, { title: "Send failed" });
    toast.success(`Sent to ${lead.business_name}${res.data.via ? ` via ${res.data.via}` : ""}.`);
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-20" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-rule bg-canvas shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <p className="eyebrow text-ink-muted">New message</p>
          <button onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-surface-alt hover:text-ink">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          {/* Recipient */}
          {lead ? (
            <div className="flex items-center justify-between rounded-lg border border-rule bg-surface-alt px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-ink">{lead.business_name}</p>
                <p className="truncate mono-num text-[11px] text-ink-subtle">{lead.email}</p>
              </div>
              <button onClick={() => { setLead(null); setQ(""); }} className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink">
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="To: search a lead by name or email…"
                className="h-9 w-full rounded-lg border border-rule-strong pl-9 pr-3 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
              />
              {(searching || hits.length > 0) && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-rule bg-canvas shadow-lg">
                  {searching ? (
                    <div className="flex items-center justify-center py-3 text-ink-subtle"><Loader2 className="h-4 w-4 animate-spin" /></div>
                  ) : (
                    hits.map((h) => (
                      <button key={h.id} onClick={() => { setLead(h); setHits([]); }} className="block w-full px-3 py-2 text-left hover:bg-surface-alt">
                        <p className="truncate text-[13px] font-medium text-ink">{h.business_name}</p>
                        <p className="truncate mono-num text-[11px] text-ink-subtle">{h.email}</p>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="h-9 w-full rounded-lg border border-rule-strong px-3 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            placeholder="Write your message…"
            className="w-full resize-y rounded-lg border border-rule-strong px-3 py-2 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
          />
          <div className="flex justify-end">
            <Button variant="primary" onClick={send} loading={sending}>
              {!sending && <Send strokeWidth={2} />} Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
