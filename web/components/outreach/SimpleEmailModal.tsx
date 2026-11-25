/**
 * outreach/SimpleEmailModal.tsx — the "Send email" window: pick what you're offering, check the email, send.
 *
 * Inputs:  a lead id; GET /api/leads/:id/send-email (to, address status, details for the templates, default
 *          service) and GET /api/email-accounts (the From list)
 * Outputs: POST /api/leads/:id/send-email { subject, body, senderEmail, followUps? } — the first email goes now,
 *          follow-ups (0–3, each with its own subject; day 4, 8, 12), only if they don't reply
 * Used by: components/leads/ContactCard.tsx, components/NextStepPill.tsx, components/LeadsTable.tsx
 *
 * The compose part (mailbox, offer, templates, subject, body) is shared with the Contact form window:
 * components/outreach/useEmailCompose.ts + ComposeFields.tsx.
 *
 * Dumb client: the templates are pure text (lib/email/service-templates.ts); every send rule (kill switch,
 * unsubscribed, address check) lives in lib/email/send-simple.ts and comes back as a plain sentence.
 */
"use client";

import { useEffect, useState } from "react";
import { Mail, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";
import { replySubject, FOLLOW_UP_GAP_DAYS } from "@/lib/email/service-templates";
import { sendTargets, targetChoices, TARGET_LABEL, type SendTarget } from "@/lib/email/send-targets";
import { useEmailCompose } from "./useEmailCompose";
import { ComposeFields, INPUT, LABEL } from "./ComposeFields";

const TONE: Record<"positive" | "warning" | "urgent" | "muted", string> = {
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  urgent: "bg-urgent-soft text-urgent",
  muted: "bg-surface-alt text-ink-subtle",
};

/** Follow-ups are back (24 Nov 2026, operator decision) behind a switch that is OFF by default: only the person
 *  sending turns them on. They are sent by the email-sequence-tick scheduler, which must be running. */
const SHOW_FOLLOW_UPS = true;

export function SimpleEmailModal({ leadId, onClose, onDone }: { leadId: string; onClose: () => void; onDone?: () => void }) {
  const c = useEmailCompose(leadId, SHOW_FOLLOW_UPS);
  const { ctx } = c;
  const [sending, setSending] = useState(false);
  // Send to: Email / Contact page / Both (Meny, 25 Nov 2026). Starts on Email when the lead can be emailed.
  const [target, setTarget] = useState<SendTarget | null>(null);

  const close = () => {
    if (sending) return;
    if (c.dirty && !window.confirm("Close without sending? What you wrote will be lost.")) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const channels = ctx ? { canEmail: ctx.canEmail, contactPage: ctx.contactPage ?? null } : null;
  const choices = channels ? targetChoices(channels) : [];
  const chosen: SendTarget | null = target && choices.includes(target) ? target : (choices[0] ?? null);
  const plan = channels && chosen ? sendTargets(chosen, channels) : null;
  // A contact form takes at most 5,000 characters (an email up to 10,000): say so before anything is sent.
  const formTooLong = !!plan?.form && c.body.trim().length > 5000;
  const canSend = !!ctx && !!plan && !plan.problem && !formTooLong && !sending && c.textReady;

  /** Contact page only: follow-ups are email-only, so they're switched off (hidden ones would block Send). */
  function pickTarget(t: SendTarget) {
    setTarget(t);
    if (t === "form") c.setFollowCount(0);
  }

  /** Their contact form: look at it and send the same subject + message once (Cloud Run, about 10 cents). */
  async function sendForm(): Promise<string | null> {
    const r = await fetchJson<{ started: boolean }>(`/api/leads/${leadId}/contact-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "look_send", senderEmail: c.from || undefined, subject: c.subject, message: c.body, offerKey: c.offerKey ?? undefined }),
    });
    return r.success ? null : r.error;
  }

  async function send() {
    if (!canSend || !ctx || !plan) return;
    setSending(true);
    c.setError(null);
    if (!plan.email) {
      const err = await sendForm();
      setSending(false);
      if (err) return void c.setError(err);
      toast.success(`AI is filling ${ctx.businessName}'s contact form with this message. Open Contact page on the lead in about 2 minutes to see the result.`);
      onDone?.();
      onClose();
      return;
    }
    const res = await fetchJson<{ via: string; followUps: number; note?: string }>(`/api/leads/${leadId}/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: c.subject,
        body: c.body,
        senderEmail: c.from || undefined,
        followUps: c.chosenFollowUps.length ? c.chosenFollowUps : undefined,
        // Which email this is (Templates page → Results; wording tests).
        used: c.used,
      }),
    });
    if (!res.success) {
      setSending(false);
      c.setError(res.error);
      onDone?.(); // an address check may have changed the lead's status
      return;
    }
    const f = res.data.followUps;
    toast.success(
      `Email sent to ${ctx.email} from ${res.data.via}.` +
        (f ? ` ${f} follow-up${f === 1 ? "" : "s"} scheduled; they stop if ${ctx.businessName} replies.` : ""),
    );
    if (res.data.note) toast.warning(res.data.note);
    if (plan.form) {
      const err = await sendForm();
      if (err) toast.warning(`The email went, but the contact form didn't start: ${err}`);
      else toast.success("AI is filling their contact form with the same message. Open Contact page on the lead in about 2 minutes to see the result.");
    }
    // Still "sending" until here, so a second click can't send the email twice while the form starts.
    setSending(false);
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
          {c.loadError && <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{c.loadError}</div>}
          {!ctx && !c.loadError && <p className="text-[13px] text-ink-muted">Loading…</p>}
          {c.error && <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{c.error}</div>}

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
              </dl>
              {!ctx.canEmail && <p className="text-[12px] text-urgent">{ctx.emailHint}</p>}

              {choices.length > 0 && (
                <fieldset className="space-y-1">
                  <legend className={LABEL}>Send to</legend>
                  <div className="flex flex-wrap gap-3 text-[12px] text-ink">
                    {choices.map((t) => (
                      <label key={t} className="flex items-center gap-1.5">
                        <input type="radio" name="send-target" checked={chosen === t} onChange={() => pickTarget(t)} disabled={sending} />
                        {TARGET_LABEL[t]}
                      </label>
                    ))}
                  </div>
                  {formTooLong && (
                    <p className="text-[12px] text-urgent">The message is too long for a contact form (5,000 characters max). Shorten it, or send by email only.</p>
                  )}
                  {plan?.form && (
                    <p className="text-[11px] text-ink-muted">
                      The same subject and message go through their contact form ({ctx.contactPage}): AI fills it with this mailbox&rsquo;s name
                      and address and presses Send once, about 10 cents. A form with a CAPTCHA is never solved: the Contact page window then
                      shows the message ready to copy.
                    </p>
                  )}
                </fieldset>
              )}

              <ComposeFields c={c} busy={sending} />
              {c.test && (
                <p className="rounded-md border border-action/30 bg-action-soft px-2.5 py-1.5 text-[12px] text-ink">
                  <span className="font-semibold">Wording test: version {c.test.variant}.</span> Send email takes turns between two versions of
                  this email; Templates → Results shows which gets more replies. You can still edit it.
                </p>
              )}

              {SHOW_FOLLOW_UPS && plan?.email !== false && (
              <div className="rounded-lg border border-rule p-3 space-y-2">
                <label className="flex items-start gap-2 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={c.followCount > 0}
                    onChange={(e) => c.setFollowCount(e.target.checked ? 1 : 0)}
                    disabled={sending}
                    aria-label="Send follow-ups if they don't reply"
                  />
                  <span>
                    <span className="font-semibold">Send follow-ups if they don&rsquo;t reply</span>
                    <span className="block text-[11px] text-ink-muted">Off = just this one email.</span>
                  </span>
                </label>
                {c.followCount > 0 && (
                  <select
                    value={c.followCount}
                    onChange={(e) => c.setFollowCount(Number(e.target.value) as 1 | 2 | 3)}
                    disabled={sending}
                    aria-label="How many follow-ups"
                    className={cx(INPUT, "h-8 w-auto")}
                  >
                    <option value={1}>1 follow-up (day {FOLLOW_UP_GAP_DAYS})</option>
                    <option value={2}>2 follow-ups (day {FOLLOW_UP_GAP_DAYS} and {FOLLOW_UP_GAP_DAYS * 2})</option>
                    <option value={3}>3 follow-ups (day {FOLLOW_UP_GAP_DAYS}, {FOLLOW_UP_GAP_DAYS * 2} and {FOLLOW_UP_GAP_DAYS * 3})</option>
                  </select>
                )}
                {c.followCount > 0 && (
                  <>
                    <p className="text-[11px] text-ink-muted">
                      From the same mailbox. Leave a subject empty to send it as a reply (&ldquo;{replySubject(c.subject || "your subject")}&rdquo;,
                      same thread), or write its own. They stop by themselves if {ctx.businessName} replies, bounces or unsubscribes.
                      {ctx.followUpsActive && " This replaces the follow-ups already scheduled for this lead."}
                    </p>
                    {c.chosenFollowUps.map((f, i) => (
                      <div key={i} className="space-y-1.5">
                        <span className={LABEL}>Follow-up {i + 1} · day {FOLLOW_UP_GAP_DAYS * (i + 1)}</span>
                        <input
                          value={f.subject}
                          onChange={(e) => c.setFollowUp(i, "subject", e.target.value)}
                          disabled={sending}
                          placeholder={replySubject(c.subject || "your subject")}
                          aria-label={`Follow-up ${i + 1} subject`}
                          maxLength={200}
                          className={cx(INPUT, "h-9")}
                        />
                        <textarea
                          value={f.body}
                          onChange={(e) => c.setFollowUp(i, "body", e.target.value)}
                          disabled={sending}
                          rows={5}
                          aria-label={`Follow-up ${i + 1}`}
                          maxLength={10000}
                          className={cx(INPUT, "py-2 leading-relaxed resize-y")}
                        />
                      </div>
                    ))}
                  </>
                )}
              </div>
              )}
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
              <Mail strokeWidth={2} />{" "}
              {plan && !plan.email ? "Send via contact form" : plan?.form ? "Send email + contact form" : c.followCount ? "Send + schedule follow-ups" : "Send email"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
