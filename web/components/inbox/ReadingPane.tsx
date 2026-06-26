"use client";

/**
 * ReadingPane.tsx — the right-hand thread viewer for the Gmail-style inbox.
 *
 * Inputs:  leadId + callbacks (onClose, onMutate to sync the list row)
 * Outputs: fetches GET /api/inbox/[id]/thread, renders the message thread + an
 *          intake-form card + the reply composer, plus per-thread actions
 *          (star, mark unread, archive, do-not-contact). Opening marks it read.
 * Used by: InboxClient.
 */

import { useEffect, useState, useCallback } from "react";
import {
  X,
  Star,
  Archive,
  Ban,
  MailOpen,
  ExternalLink,
  Mail,
  Phone,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { InboxReply } from "@/components/InboxReply";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { relativeTime } from "@/lib/format";
import type { ThreadMutation } from "@/components/inbox/InboxClient";

interface Msg {
  id: string;
  direction: "outbound" | "inbound";
  subject: string | null;
  body_text: string | null;
  to_addr: string | null;
  from_addr: string | null;
  status: string;
  created_at: string;
}
interface ThreadLead {
  id: string;
  business_name: string;
  email: string | null;
  phone: string | null;
  website_url: string | null;
  is_favorite: boolean | null;
  lifecycle_stage: string | null;
}
interface FormSub {
  answers: { name?: string; email?: string; bestTime?: string; details?: string } | null;
  created_at: string;
}
interface ThreadData {
  lead: ThreadLead;
  messages: Msg[];
  mailboxes: { email: string; from_name: string | null }[];
  form: FormSub | null;
}

export function ReadingPane({
  leadId,
  isFavorite,
  onClose,
  onMutate,
}: {
  leadId: string;
  isFavorite: boolean;
  onClose: () => void;
  onMutate: (id: string, patch: ThreadMutation) => void;
}) {
  const [data, setData] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchJson<ThreadData>(`/api/inbox/${leadId}/thread`);
    setLoading(false);
    if (res.success) {
      setData(res.data);
      // The GET marks it read server-side — reflect that in the list.
      onMutate(leadId, { unread: false });
    }
  }, [leadId, onMutate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>, optimistic: ThreadMutation, okMsg: string) {
    setBusy(true);
    const res = await fetchJson<{ updated: number }>("/api/inbox/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_ids: [leadId], ...body }),
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error, { title: "Action failed" });
      return;
    }
    onMutate(leadId, optimistic);
    toast.success(okMsg);
  }

  const dnc = data?.lead.lifecycle_stage === "dnc" || data?.lead.lifecycle_stage === "unsubscribed";

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* Action bar */}
      <div className="flex items-center gap-1 border-b border-rule px-3 py-2">
        <button
          onClick={onClose}
          className="rounded p-1.5 text-ink-muted hover:bg-surface-alt hover:text-ink lg:hidden"
          title="Back"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-ink">
            {data?.lead.business_name ?? "…"}
          </p>
        </div>
        <IconBtn
          title={isFavorite ? "Unstar" : "Star"}
          active={isFavorite}
          disabled={busy}
          onClick={() =>
            act(
              { is_favorite: !isFavorite },
              { isFavorite: !isFavorite },
              isFavorite ? "Unstarred" : "Starred",
            )
          }
        >
          <Star className="h-4 w-4" strokeWidth={1.75} fill={isFavorite ? "currentColor" : "none"} />
        </IconBtn>
        <IconBtn
          title="Mark unread"
          disabled={busy}
          onClick={() => {
            void act({ read: false }, { unread: true }, "Marked unread");
            onClose();
          }}
        >
          <MailOpen className="h-4 w-4" strokeWidth={1.75} />
        </IconBtn>
        <IconBtn
          title="Archive (Done)"
          disabled={busy}
          onClick={() => {
            void act({ archive: true }, { inboxStatus: "closed" }, "Archived");
            onClose();
          }}
        >
          <Archive className="h-4 w-4" strokeWidth={1.75} />
        </IconBtn>
        <IconBtn
          title="Do not contact"
          danger
          disabled={busy || dnc}
          onClick={() => {
            if (!confirm("Mark this lead Do-Not-Contact? It stops any sequence and suppresses all future sends.")) return;
            void act({ dnc: true }, { lifecycleStage: "dnc", inboxStatus: "closed" }, "Marked do-not-contact");
            onClose();
          }}
        >
          <Ban className="h-4 w-4" strokeWidth={1.75} />
        </IconBtn>
        {data?.lead && (
          <Link
            href={`/leads/${leadId}`}
            className="ml-1 rounded p-1.5 text-ink-muted hover:bg-surface-alt hover:text-ink"
            title="Open lead"
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
          </Link>
        )}
      </div>

      {/* Body */}
      {loading || !data ? (
        <div className="flex flex-1 items-center justify-center text-ink-subtle">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Contact line */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
            {data.lead.email && (
              <span className="inline-flex items-center gap-1.5 mono-num">
                <Mail className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.75} /> {data.lead.email}
              </span>
            )}
            {data.lead.phone && (
              <a href={`tel:${data.lead.phone}`} className="inline-flex items-center gap-1.5 mono-num hover:text-ink">
                <Phone className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.75} /> {data.lead.phone}
              </a>
            )}
            {dnc && (
              <span className="rounded bg-urgent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-urgent">
                Do not contact
              </span>
            )}
          </div>

          {/* Intake form */}
          {data.form && (
            <section className="card mb-4 border-l-2 border-l-positive p-4">
              <p className="eyebrow mb-2 text-positive">They filled out your form</p>
              <dl className="space-y-2 text-[13px]">
                <FormRow label="Name" value={data.form.answers?.name} />
                <FormRow label="Email" value={data.form.answers?.email} />
                <FormRow label="Best time" value={data.form.answers?.bestTime} />
                <FormRow label="What they need" value={data.form.answers?.details} />
              </dl>
            </section>
          )}

          {/* Thread */}
          {data.messages.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-ink-muted">
              No email messages yet.
            </p>
          ) : (
            <div className="space-y-3">
              {data.messages.map((m) => {
                const out = m.direction === "outbound";
                return (
                  <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3.5 py-2.5 ${out ? "bg-ink text-canvas" : "bg-surface border border-rule"}`}>
                      {m.subject && (
                        <p className={`mb-1 text-[11px] font-semibold ${out ? "text-canvas/70" : "text-ink-subtle"}`}>
                          {m.subject}
                        </p>
                      )}
                      <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${out ? "text-canvas" : "text-ink"}`}>
                        {m.body_text || "(no content)"}
                      </p>
                      <p className={`mt-1.5 text-[10px] ${out ? "text-canvas/50" : "text-ink-subtle"}`}>
                        {out ? "Sent" : "Received"} · {relativeTime(m.created_at)}
                        {out && m.status === "failed" ? " · failed" : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Reply */}
          {data.lead.email ? (
            <InboxReply
              leadId={leadId}
              mailboxes={data.mailboxes}
              defaultSender={
                [...data.messages].reverse().find((m) => m.direction === "inbound")?.to_addr ??
                data.mailboxes[0]?.email ??
                null
              }
            />
          ) : (
            <p className="mt-6 text-center text-[11px] text-ink-subtle">
              No email on file — follow up from the lead&apos;s page.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  active,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded p-1.5 transition-colors disabled:opacity-40",
        active ? "text-warning" : danger ? "text-ink-muted hover:bg-urgent-soft hover:text-urgent" : "text-ink-muted hover:bg-surface-alt hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function FormRow({ label, value }: { label: string; value?: string | null }) {
  if (!value || !value.trim()) return null;
  return (
    <div className="flex gap-3">
      <dt className="w-28 flex-none pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="flex-1 whitespace-pre-wrap break-words text-ink">{value}</dd>
    </div>
  );
}
