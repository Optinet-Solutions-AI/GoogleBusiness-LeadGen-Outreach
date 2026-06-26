"use client";

/**
 * LeadThreadLink.tsx — a lead name that opens a slide-over of the email history.
 *
 * Inputs:  leadId + display name/subtitle
 * Outputs: on click, a right-hand drawer fetches GET /api/inbox/[id]/thread and
 *          shows the sent/received messages (read-only history) + links to reply
 *          in the inbox or open the full lead.
 * Used by: campaign detail lead queue.
 */

import { useState } from "react";
import Link from "next/link";
import { X, Mail, Phone, ExternalLink, MessageSquare, Loader2 } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { relativeTime } from "@/lib/format";

interface Msg {
  id: string;
  direction: "outbound" | "inbound";
  subject: string | null;
  body_text: string | null;
  status: string;
  created_at: string;
}
interface ThreadData {
  lead: { id: string; business_name: string; email: string | null; phone: string | null };
  messages: Msg[];
}

export function LeadThreadLink({
  leadId,
  businessName,
  subtitle,
}: {
  leadId: string;
  businessName: string;
  subtitle?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(false);

  async function openDrawer() {
    setOpen(true);
    if (data) return;
    setLoading(true);
    const res = await fetchJson<ThreadData>(`/api/inbox/${leadId}/thread`);
    setLoading(false);
    if (res.success) setData(res.data);
  }

  return (
    <>
      <button onClick={openDrawer} className="block text-left">
        <div className="text-[14px] font-semibold text-ink hover:text-action truncate">{businessName}</div>
        {subtitle && <div className="text-[11px] text-ink-subtle">{subtitle}</div>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={() => setOpen(false)}>
          <div className="flex h-full w-full max-w-md flex-col bg-canvas shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-ink">{businessName}</p>
                <p className="eyebrow text-ink-subtle">Message history</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-ink-muted hover:bg-surface-alt hover:text-ink">
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loading || !data ? (
                <div className="flex h-full items-center justify-center text-ink-subtle"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                    {data.lead.email && (
                      <span className="inline-flex items-center gap-1.5 mono-num"><Mail className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.75} /> {data.lead.email}</span>
                    )}
                    {data.lead.phone && (
                      <span className="inline-flex items-center gap-1.5 mono-num"><Phone className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.75} /> {data.lead.phone}</span>
                    )}
                  </div>

                  {data.messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <MessageSquare className="h-6 w-6 text-ink-subtle" strokeWidth={1.5} />
                      <p className="mt-2 text-[13px] text-ink-muted">No emails sent yet.</p>
                      <p className="text-[11px] text-ink-subtle">Messages appear here once the campaign sends to this lead.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {data.messages.map((m) => {
                        const out = m.direction === "outbound";
                        return (
                          <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[85%] rounded-lg px-3.5 py-2.5 ${out ? "bg-ink text-canvas" : "bg-surface border border-rule"}`}>
                              {m.subject && <p className={`mb-1 text-[11px] font-semibold ${out ? "text-canvas/70" : "text-ink-subtle"}`}>{m.subject}</p>}
                              <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${out ? "text-canvas" : "text-ink"}`}>{m.body_text || "(no content)"}</p>
                              <p className={`mt-1.5 text-[10px] ${out ? "text-canvas/50" : "text-ink-subtle"}`}>
                                {out ? "Sent" : "Received"} · {relativeTime(m.created_at)}{out && m.status === "failed" ? " · failed" : ""}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-rule px-4 py-3">
              <Link href={`/inbox/${leadId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12px] font-semibold text-canvas hover:bg-ink/90">
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} /> Open in inbox
              </Link>
              <Link href={`/leads/${leadId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-rule px-3 py-2 text-[12px] font-medium text-ink-muted hover:bg-surface-alt hover:text-ink">
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} /> Open lead
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
