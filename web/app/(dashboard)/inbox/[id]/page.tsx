/**
 * (dashboard)/inbox/[id]/page.tsx — Email conversation thread for one lead.
 *
 * Inputs:  lead + email_messages (ordered oldest→newest)
 * Outputs: the sent ↔ received thread as chat bubbles, with lead context + a
 *          link to the full lead. Replies are pulled by the Inbox "Sync replies"
 *          action (POST /api/email/sync) which reads IMAP.
 * Used by: route "/inbox/[id]" (opened from the Inbox conversation list)
 *
 * Read-only for now: free-text reply *sending* is the next step — for now,
 * follow up from the lead's detail page.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Mail, Phone } from "lucide-react";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  business_name: string;
  email: string | null;
  phone: string | null;
  stage: string;
}

interface Msg {
  id: string;
  direction: "outbound" | "inbound";
  subject: string | null;
  body_text: string | null;
  status: string;
  created_at: string;
}

async function getThread(id: string): Promise<{ lead: Lead; messages: Msg[] } | null> {
  if (!isDbConfigured()) return null;
  return safeDb(async (db) => {
    const { data: lead } = await db
      .from("leads")
      .select("id,business_name,email,phone,stage")
      .eq("id", id)
      .maybeSingle();
    if (!lead) return null;
    const { data: msgs } = await db
      .from("email_messages")
      .select("id,direction,subject,body_text,status,created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: true })
      .limit(500);
    return { lead: lead as Lead, messages: (msgs ?? []) as Msg[] };
  }, null);
}

export default async function ThreadPage({ params }: { params: { id: string } }) {
  const data = await getThread(params.id);
  if (!data) notFound();
  const { lead, messages } = data;

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/inbox"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink transition-colors mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} /> Inbox
      </Link>

      {/* Lead header */}
      <header className="card p-5 mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="editorial-head text-ink text-[22px] leading-tight truncate">{lead.business_name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
            {lead.email && (
              <span className="inline-flex items-center gap-1.5 mono-num">
                <Mail className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.75} /> {lead.email}
              </span>
            )}
            {lead.phone && (
              <span className="inline-flex items-center gap-1.5 mono-num">
                <Phone className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.75} /> {lead.phone}
              </span>
            )}
          </div>
        </div>
        <Link href={`/leads/${lead.id}`} className="btn btn-secondary btn-sm flex-shrink-0">
          Open lead
          <ExternalLink strokeWidth={1.75} />
        </Link>
      </header>

      {/* Thread */}
      {messages.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-[13px] text-ink-muted">
            No email messages yet. Sent emails appear here once you send from the lead, and replies
            arrive via <span className="font-semibold text-ink">Sync replies</span> on the Inbox.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => {
            const out = m.direction === "outbound";
            return (
              <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[82%] rounded-lg px-3.5 py-2.5 ${
                    out ? "bg-ink text-canvas" : "bg-surface border border-rule"
                  }`}
                >
                  {m.subject && (
                    <p className={`text-[11px] font-semibold mb-1 ${out ? "text-canvas/70" : "text-ink-subtle"}`}>
                      {m.subject}
                    </p>
                  )}
                  <p
                    className={`text-[13px] whitespace-pre-wrap break-words leading-relaxed ${
                      out ? "text-canvas" : "text-ink"
                    }`}
                  >
                    {m.body_text || "(no content)"}
                  </p>
                  <p className={`text-[10px] mt-1.5 ${out ? "text-canvas/50" : "text-ink-subtle"}`}>
                    {out ? "Sent" : "Received"} · {relativeTime(m.created_at)}
                    {out && m.status === "failed" ? " · failed" : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-ink-subtle text-center mt-6">
        Replying from here is coming next — for now, follow up from the lead&apos;s page.
      </p>
    </div>
  );
}
