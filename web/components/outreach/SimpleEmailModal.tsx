/**
 * outreach/SimpleEmailModal.tsx — the "Send email" window: pick what you're offering, check the email, send.
 *
 * Inputs:  a lead id; GET /api/leads/:id/send-email (to, address status, details for the templates, default
 *          service) and GET /api/email-accounts (the From list)
 * Outputs: POST /api/leads/:id/send-email { subject, body, senderEmail, followUps? } — the first email goes now,
 *          follow-ups (0–2) 4 days apart, only if they don't reply
 * Used by: components/leads/ContactCard.tsx, components/NextStepPill.tsx, components/LeadsTable.tsx
 *
 * Dumb client: the templates are pure text (lib/email/service-templates.ts); every send rule (kill switch,
 * unsubscribed, address check) lives in lib/email/send-simple.ts and comes back as a plain sentence.
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
import { SERVICES, serviceEmail, replySubject, FOLLOW_UP_GAP_DAYS, type ServiceKey } from "@/lib/email/service-templates";

const TONE: Record<"positive" | "warning" | "urgent" | "muted", string> = {
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  urgent: "bg-urgent-soft text-urgent",
  muted: "bg-surface-alt text-ink-subtle",
};
const INPUT =
  "w-full px-3 text-[13px] text-ink border border-rule-strong rounded-md bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none disabled:bg-surface-alt";
const LABEL = "block text-[11px] font-semibold text-ink-muted mb-1";

interface ComposeContext {
  leadId: string;
  businessName: string;
  email: string | null;
  emailLabel: string;
  emailTone: "positive" | "warning" | "urgent" | "muted";
  emailHint: string;
  canEmail: boolean;
  unchecked: boolean;
  ownerName: string | null;
  city: string | null;
  category: string | null;
  demoUrl: string | null;
  eventName: string | null;
  booth: string | null;
  defaultService: ServiceKey;
  followUpsActive: boolean;
}
type Mailbox = { email: string; from_name: string | null };

export function SimpleEmailModal({ leadId, onClose, onDone }: { leadId: string; onClose: () => void; onDone?: () => void }) {
  const [ctx, setCtx] = useState<ComposeContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[] | null>(null);
  const [from, setFrom] = useState("");
  const [service, setService] = useState<ServiceKey>("custom");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [followCount, setFollowCount] = useState<0 | 1 | 2>(0);
  const [followUps, setFollowUps] = useState<[string, string]>(["", ""]);
  // True once the operator types: changing the service / mailbox then asks before replacing their words.
  const [edited, setEdited] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const senderName = (mailboxes ?? []).find((m) => m.email === from)?.from_name ?? null;

  function fill(next: ServiceKey, c: ComposeContext, sender: string | null) {
    const t = serviceEmail(next, {
      businessName: c.businessName,
      ownerName: c.ownerName,
      city: c.city,
      category: c.category,
      demoUrl: c.demoUrl,
      eventName: c.eventName,
      booth: c.booth,
      senderName: sender,
    });
    setService(next);
    setSubject(t.subject);
    setBody(t.body);
    setFollowUps(t.followUps);
    setEdited(false);
  }

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchJson<ComposeContext>(`/api/leads/${leadId}/send-email`),
      fetchJson<{ mailboxes: Mailbox[] }>("/api/email-accounts"),
    ]).then(([c, m]) => {
      if (!alive) return;
      const list = m.success ? m.data.mailboxes : [];
      setMailboxes(list);
      setFrom(list[0]?.email ?? "");
      if (!c.success) {
        setLoadError(c.error);
        return;
      }
      setCtx(c.data);
      fill(c.data.defaultService, c.data, list[0]?.from_name ?? null);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const dirty = edited && (subject.trim() !== "" || body.trim() !== "");
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

  function pickService(next: ServiceKey) {
    if (!ctx || next === service) return;
    if (edited && !window.confirm("Replace what you wrote with the ready-made email for this service?")) return;
    fill(next, ctx, senderName);
  }

  function pickMailbox(email: string) {
    setFrom(email);
    // Re-sign the ready-made text with the new sender's name, unless the operator already changed it.
    if (ctx && !edited) fill(service, ctx, (mailboxes ?? []).find((m) => m.email === email)?.from_name ?? null);
  }

  const spam = useMemo(() => (subject.trim() && body.trim() ? spamCheck(subject, textToHtml(body)) : null), [subject, body]);
  const noMailbox = mailboxes !== null && mailboxes.length === 0;
  const chosenFollowUps = followUps.slice(0, followCount);
  const followUpsFilled = chosenFollowUps.every((f) => f.trim() !== "");
  const canSend =
    !!ctx && ctx.canEmail && !sending && !noMailbox && mailboxes !== null && subject.trim() !== "" && body.trim() !== "" && followUpsFilled;

  async function send() {
    if (!canSend || !ctx) return;
    setSending(true);
    setError(null);
    const res = await fetchJson<{ via: string; followUps: number; note?: string }>(`/api/leads/${leadId}/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body, senderEmail: from || undefined, followUps: chosenFollowUps.length ? chosenFollowUps : undefined }),
    });
    setSending(false);
    if (!res.success) {
      setError(res.error);
      onDone?.(); // an address check may have changed the lead's status
      return;
    }
    const f = res.data.followUps;
    toast.success(
      `Email sent to ${ctx.email} from ${res.data.via}.` +
        (f ? ` ${f} follow-up${f === 1 ? "" : "s"} scheduled; they stop if ${ctx.businessName} replies.` : ""),
    );
    if (res.data.note) toast.warning(res.data.note);
    onDone?.();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-end sm:items-center justify-center sm:p-4" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Send email"
        className="bg-white w-full sm:max-w-[640px] max-h-[94vh] flex flex-col rounded-t-xl sm:rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-rule">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">Email {ctx?.businessName ?? "this lead"}</h2>
            <p className="text-[12px] text-ink-muted">Pick what you&rsquo;re offering, check the wording, send. The first email goes right away.</p>
          </div>
          <button type="button" onClick={close} disabled={sending} aria-label="Close" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loadError && <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{loadError}</div>}
          {!ctx && !loadError && <p className="text-[13px] text-ink-muted">Loading…</p>}
          {error && <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{error}</div>}

          {ctx && (
            <>
              <dl className="grid grid-cols-[56px_1fr] items-center gap-x-3 gap-y-2 text-[12px]">
                <dt className="text-ink-muted">To</dt>
                <dd className="text-ink min-w-0 flex flex-wrap items-center gap-1.5">
                  {ctx.email ? <span className="mono-num break-all">{ctx.email}</span> : <span className="text-urgent">No email address</span>}
                  <span className={cx("px-1.5 py-0.5 rounded text-[10px] font-semibold", TONE[ctx.emailTone])} title={ctx.emailHint}>
                    {ctx.emailLabel}
                  </span>
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
                    <select value={from} onChange={(e) => pickMailbox(e.target.value)} disabled={sending} aria-label="Send from" className={cx(INPUT, "h-8")}>
                      {mailboxes.map((m) => (
                        <option key={m.email} value={m.email}>
                          {m.from_name ? `${m.from_name} <${m.email}>` : m.email}
                        </option>
                      ))}
                    </select>
                  )}
                </dd>
              </dl>
              {!ctx.canEmail && <p className="text-[12px] text-urgent">{ctx.emailHint}</p>}

              <label className="block">
                <span className={LABEL}>What are you offering?</span>
                <select
                  value={service}
                  onChange={(e) => pickService(e.target.value as ServiceKey)}
                  disabled={sending}
                  aria-label="Service"
                  className={cx(INPUT, "h-9")}
                >
                  {SERVICES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                      {s.key === ctx.defaultService ? " (fits this lead)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <input
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setEdited(true);
                }}
                disabled={sending}
                placeholder="Subject"
                aria-label="Subject"
                maxLength={200}
                className={cx(INPUT, "h-9 font-semibold")}
              />
              <textarea
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setEdited(true);
                }}
                disabled={sending}
                rows={11}
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

              <div className="rounded-lg border border-rule p-3 space-y-2">
                <label className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
                  <span className="font-semibold">Follow-ups if they don&rsquo;t reply</span>
                  <select
                    value={followCount}
                    onChange={(e) => setFollowCount(Number(e.target.value) as 0 | 1 | 2)}
                    disabled={sending}
                    aria-label="Follow-ups"
                    className={cx(INPUT, "h-8 w-auto")}
                  >
                    <option value={0}>None, just this email</option>
                    <option value={1}>1 follow-up (day {FOLLOW_UP_GAP_DAYS})</option>
                    <option value={2}>2 follow-ups (day {FOLLOW_UP_GAP_DAYS} and {FOLLOW_UP_GAP_DAYS * 2})</option>
                  </select>
                </label>
                {followCount > 0 && (
                  <>
                    <p className="text-[11px] text-ink-muted">
                      Sent as a reply (&ldquo;{replySubject(subject || "your subject")}&rdquo;) from the same mailbox. They stop by
                      themselves if {ctx.businessName} replies, bounces or unsubscribes.
                      {ctx.followUpsActive && " This replaces the follow-ups already scheduled for this lead."}
                    </p>
                    {chosenFollowUps.map((f, i) => (
                      <label key={i} className="block">
                        <span className={LABEL}>Follow-up {i + 1} · day {FOLLOW_UP_GAP_DAYS * (i + 1)}</span>
                        <textarea
                          value={f}
                          onChange={(e) => {
                            const next: [string, string] = [...followUps];
                            next[i] = e.target.value;
                            setFollowUps(next);
                            setEdited(true);
                          }}
                          disabled={sending}
                          rows={5}
                          aria-label={`Follow-up ${i + 1}`}
                          maxLength={10000}
                          className={cx(INPUT, "py-2 leading-relaxed resize-y")}
                        />
                      </label>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-rule flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink-muted min-w-0 flex-1">
            {ctx?.unchecked
              ? "The address is checked first (under 1 cent). If it's bad, nothing is sent."
              : "Replies show up in the Inbox."}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close} disabled={sending}>Cancel</Button>
            <Button onClick={send} loading={sending} disabled={!canSend}>
              <Mail strokeWidth={2} /> {followCount ? "Send + schedule follow-ups" : "Send email"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
