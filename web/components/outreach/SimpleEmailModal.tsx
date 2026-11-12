/**
 * outreach/SimpleEmailModal.tsx — write and send one plain email to a lead (no pitch, no follow-ups).
 *
 * Inputs:  the lead (id, business name, email + its check status); GET /api/email-accounts for the From list
 * Outputs: POST /api/leads/:id/send-email { subject, body, senderEmail } — sent right away
 * Used by: components/leads/ContactCard.tsx ("Send email" on the lead page)
 *
 * Dumb client: every rule (kill switch, unsubscribed, address check) lives in lib/email/send-simple.ts and comes
 * back as a plain sentence.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";
import { spamCheck } from "@/lib/email/spam-check";
import { textToHtml } from "@/lib/email/plain-text";

const TONE: Record<"positive" | "warning" | "urgent" | "muted", string> = {
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  urgent: "bg-urgent-soft text-urgent",
  muted: "bg-surface-alt text-ink-subtle",
};
const INPUT =
  "w-full px-3 text-[13px] text-ink border border-rule-strong rounded-md bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none disabled:bg-surface-alt";

export interface SimpleEmailLead {
  id: string;
  businessName: string;
  email: string;
  emailLabel: string;
  emailTone: "positive" | "warning" | "urgent" | "muted";
  /** Never checked: the send checks it first (under 1 cent). */
  unchecked: boolean;
}

export function SimpleEmailModal({ lead, onClose, onDone }: { lead: SimpleEmailLead; onClose: () => void; onDone?: () => void }) {
  const [mailboxes, setMailboxes] = useState<{ email: string; from_name: string | null }[] | null>(null);
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchJson<{ mailboxes: { email: string; from_name: string | null }[] }>("/api/email-accounts").then((res) => {
      if (!alive) return;
      const list = res.success ? res.data.mailboxes : [];
      setMailboxes(list);
      setFrom(list[0]?.email ?? "");
    });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = subject.trim() !== "" || body.trim() !== "";
  const close = () => {
    if (sending) return;
    if (dirty && !window.confirm("Close without sending? What you wrote will be lost.")) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const spam = useMemo(() => (subject.trim() && body.trim() ? spamCheck(subject, textToHtml(body)) : null), [subject, body]);
  const noMailbox = mailboxes !== null && mailboxes.length === 0;
  const canSend = !sending && !noMailbox && mailboxes !== null && subject.trim() !== "" && body.trim() !== "";

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const res = await fetchJson<{ via: string }>(`/api/leads/${lead.id}/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body, senderEmail: from || undefined }),
    });
    setSending(false);
    if (!res.success) {
      setError(res.error);
      onDone?.(); // an address check may have changed the lead's status
      return;
    }
    toast.success(`Email sent to ${lead.email} from ${res.data.via}.`);
    onDone?.();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-end sm:items-center justify-center sm:p-4" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Send email"
        className="bg-white w-full sm:max-w-[620px] max-h-[94vh] flex flex-col rounded-t-xl sm:rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-rule">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">Email {lead.businessName}</h2>
            <p className="text-[12px] text-ink-muted">One email, sent right away. No automatic follow-ups.</p>
          </div>
          <button type="button" onClick={close} disabled={sending} aria-label="Close" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{error}</div>}

          <dl className="grid grid-cols-[56px_1fr] items-center gap-x-3 gap-y-2 text-[12px]">
            <dt className="text-ink-muted">To</dt>
            <dd className="text-ink min-w-0 flex flex-wrap items-center gap-1.5">
              <span className="mono-num break-all">{lead.email}</span>
              <span className={cx("px-1.5 py-0.5 rounded text-[10px] font-semibold", TONE[lead.emailTone])}>{lead.emailLabel}</span>
            </dd>
            <dt className="text-ink-muted">From</dt>
            <dd className="min-w-0">
              {mailboxes === null ? (
                <span className="text-ink-subtle">Loading mailboxes…</span>
              ) : noMailbox ? (
                <span className="text-urgent">No sending mailbox is connected. Connect one on the Email page first.</span>
              ) : mailboxes.length === 1 ? (
                <span className="text-ink break-all">{mailboxes[0].email}</span>
              ) : (
                <select value={from} onChange={(e) => setFrom(e.target.value)} disabled={sending} aria-label="Send from" className={cx(INPUT, "h-8")}>
                  {mailboxes.map((m) => (
                    <option key={m.email} value={m.email}>
                      {m.from_name ? `${m.from_name} <${m.email}>` : m.email}
                    </option>
                  ))}
                </select>
              )}
            </dd>
          </dl>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
            placeholder="Subject"
            aria-label="Subject"
            maxLength={200}
            className={cx(INPUT, "h-9 font-semibold")}
            autoFocus
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={sending}
            rows={12}
            placeholder={"Hi,\n\n…\n\nThanks,\nSam"}
            aria-label="Email"
            maxLength={10000}
            className={cx(INPUT, "py-2 leading-relaxed resize-y")}
          />
          <p className="text-[11px] text-ink-subtle">Plain text, sent exactly as written. A blank line starts a new paragraph.</p>
          {spam && spam.level !== "low" && (
            <p className="text-[11px] text-warning">
              Spam-filter risk: {spam.level}. {spam.flags.slice(0, 3).join(" · ")}
            </p>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-rule flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink-muted min-w-0 flex-1">
            {lead.unchecked
              ? "The address is checked first (under 1 cent). If it's bad, nothing is sent."
              : "Replies show up in the Inbox."}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close} disabled={sending}>Cancel</Button>
            <Button onClick={send} loading={sending} disabled={!canSend}>
              <Mail strokeWidth={2} /> Send email
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
