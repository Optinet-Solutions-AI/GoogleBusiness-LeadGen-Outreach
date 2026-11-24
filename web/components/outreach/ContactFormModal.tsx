/**
 * outreach/ContactFormModal.tsx — the "Contact form" window: see their website's contact form, write the message
 * (same offers + saved templates as Send email), and have AI fill it in and send it once.
 *
 * Inputs:  a lead id; GET/POST /api/leads/:id/contact-form (latest attempt, start a look / a send), plus what
 *          useEmailCompose loads (offers, templates, mailboxes)
 * Outputs: POST { action: "look", force? } | { action: "send", runId, senderEmail, subject, message, offerKey }
 * Used by: components/leads/ContactCard.tsx
 *
 * Dumb client: every rule (pause switch, unsubscribed, one attempt at a time, own site only, one submit) is on the
 * server and comes back as a plain sentence. The worker takes about a minute per step, so this polls.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";
import { useEmailCompose } from "./useEmailCompose";
import { ComposeFields } from "./ComposeFields";

type Status = "looking" | "ready" | "no_form" | "sending" | "sent" | "blocked" | "failed" | "unknown";
interface RunView {
  id: string;
  status: Status;
  effective: Status;
  text: string;
  contact_url: string | null;
  form_shot_url: string | null;
  filled_shot_url: string | null;
  result_shot_url: string | null;
  sender_email: string | null;
  message: string | null;
  usd: number | null;
}

const POLL_MS = 4000;
const POLL_LIMIT_MS = 5 * 60_000;
const ACTIVE = new Set<Status>(["looking", "sending"]);
const TONE: Record<Status, string> = {
  looking: "border-rule bg-surface-alt",
  sending: "border-rule bg-surface-alt",
  ready: "border-rule bg-surface-alt",
  sent: "border-positive/30 bg-positive-soft",
  unknown: "border-warning/30 bg-warning-soft",
  no_form: "border-warning/30 bg-warning-soft",
  blocked: "border-warning/30 bg-warning-soft",
  failed: "border-urgent/30 bg-urgent-soft",
};

function Shot({ url, label }: { url: string; label: string }) {
  return (
    <figure className="min-w-0">
      <a href={url} target="_blank" rel="noreferrer" title="Open full size">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className="w-full rounded-md border border-rule" />
      </a>
      <figcaption className="mt-1 text-[11px] text-ink-subtle">{label}</figcaption>
    </figure>
  );
}

export function ContactFormModal({
  leadId,
  contactPageUrl,
  onClose,
  onDone,
}: {
  leadId: string;
  /** The lead's saved contact page, linked straight away (before the form has been looked at). */
  contactPageUrl?: string | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const c = useEmailCompose(leadId, false);
  const [run, setRun] = useState<RunView | null>(null);
  const [estimate, setEstimate] = useState(0.1);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const pollStart = useRef<number>(0);

  const refresh = useCallback(async (): Promise<RunView | null | "error"> => {
    const r = await fetchJson<{ run: RunView | null; estimateUsd: number }>(`/api/leads/${leadId}/contact-form`);
    if (!r.success) {
      setError(r.error);
      return "error";
    }
    setEstimate(r.data.estimateUsd);
    setRun(r.data.run);
    return r.data.run;
  }, [leadId]);

  const look = useCallback(
    async (force: boolean) => {
      setPosting(true);
      setError(null);
      setGaveUp(false);
      const r = await fetchJson<{ started: boolean }>(`/api/leads/${leadId}/contact-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "look", force }),
      });
      setPosting(false);
      if (!r.success) return void setError(r.error);
      pollStart.current = Date.now();
      await refresh();
    },
    [leadId, refresh],
  );

  // Open: show a running / finished attempt, else take a look (a ready look from the last 24 h is reused, free).
  useEffect(() => {
    let alive = true;
    refresh().then((r) => {
      if (!alive || r === "error") return;
      pollStart.current = Date.now();
      const finishedSend = r && r.sender_email && ["sent", "unknown", "failed", "blocked"].includes(r.effective);
      if (r && (ACTIVE.has(r.effective) || finishedSend)) return;
      void look(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // Poll while the worker is busy.
  const active = !!run && ACTIVE.has(run.effective);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      if (Date.now() - pollStart.current > POLL_LIMIT_MS) {
        setGaveUp(true);
        clearInterval(t);
        return;
      }
      const r = await refresh();
      if (r && r !== "error" && r.effective === "sent") {
        toast.success("Contact form sent.");
        onDone?.();
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [active, refresh, onDone]);

  async function send() {
    if (!run || run.effective !== "ready" || !c.textReady) return;
    setPosting(true);
    setError(null);
    const r = await fetchJson<{ started: boolean }>(`/api/leads/${leadId}/contact-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send",
        runId: run.id,
        senderEmail: c.from || undefined,
        subject: c.subject,
        message: c.body,
        offerKey: c.offerKey ?? undefined,
      }),
    });
    setPosting(false);
    if (!r.success) return void setError(r.error);
    pollStart.current = Date.now();
    setGaveUp(false);
    await refresh();
  }

  const ready = run?.effective === "ready";
  // CAPTCHA hand-off (24 Nov 2026): a protected form is never solved by AI; the operator sends it themselves.
  const blocked = run?.effective === "blocked";
  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(c.subject.trim() ? `${c.subject.trim()}

${c.body}` : c.body);
      toast.success("Message copied. Paste it into their form.");
    } catch {
      toast.error("Couldn't copy: select the message and copy it by hand.");
    }
  }
  async function sentByHand() {
    if (!run || !blocked || !c.body.trim()) return;
    setPosting(true);
    setError(null);
    const r = await fetchJson<{ recorded: boolean }>(`/api/leads/${leadId}/contact-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "manual", runId: run.id, subject: c.subject, message: c.body, offerKey: c.offerKey ?? undefined }),
    });
    setPosting(false);
    if (!r.success) return void setError(r.error);
    toast.success("Recorded as sent by hand.");
    await refresh();
    onDone?.();
  }
  const close = () => {
    if (ready && c.dirty && !window.confirm("Close without sending? What you wrote will be lost.")) return;
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const afterSend = !!run && !!run.sender_email && !ready && !active;
  const canLookAgain = !!run && !active && !posting;
  // Their contact page: the one the look found, else the lead's saved one (linked before any look).
  const pageUrl = run?.contact_url || contactPageUrl || null;
  const canSend = ready && !posting && c.textReady;
  const cents = Math.max(1, Math.round(estimate * 100));

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-end sm:items-center justify-center sm:p-4" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Contact form"
        className="bg-white w-full sm:max-w-[720px] max-h-[94vh] flex flex-col rounded-t-xl sm:rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-rule">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">Contact page · {c.ctx?.businessName ?? "this lead"}</h2>
            <p className="text-[12px] text-ink-muted">
              See their contact form, write your message, and AI fills it in and sends it once. Or open the page yourself.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{error}</div>}
          {c.error && <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{c.error}</div>}
          {!run && !error && <p className="text-[13px] text-ink-muted">{posting ? "Starting…" : "Loading…"}</p>}

          {run && (
            <div className={cx("rounded-lg border px-3 py-2 text-[12px] text-ink", TONE[run.effective])}>
              {run.text}
              {active && <span className="block mt-1 text-ink-subtle">This takes about a minute. You can close this window; it keeps going.</span>}
              {gaveUp && <span className="block mt-1 text-ink-subtle">Still working — close this and check back in a few minutes.</span>}
              {run.usd != null && run.usd > 0 && <span className="block mt-1 text-ink-subtle">AI cost: ${run.usd.toFixed(2)}</span>}
            </div>
          )}

          {(pageUrl || (run && canLookAgain)) && (
            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              {pageUrl && (
                <a href={pageUrl} target="_blank" rel="noreferrer" className="text-action hover:underline inline-flex items-center gap-1">
                  Open their contact page <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {run && canLookAgain && (
                <Button size="sm" variant="ghost" onClick={() => void look(true)}>
                  <RefreshCw className="h-3.5 w-3.5" /> {afterSend ? "New message" : "Look again"}
                </Button>
              )}
            </div>
          )}

          {run && !afterSend && run.form_shot_url && <Shot url={run.form_shot_url} label="Their contact form (nothing filled in yet)" />}
          {afterSend && (run.filled_shot_url || run.result_shot_url) && (
            <div className="grid sm:grid-cols-2 gap-3">
              {run.filled_shot_url && <Shot url={run.filled_shot_url} label="Filled in, just before Send" />}
              {run.result_shot_url && <Shot url={run.result_shot_url} label="Their page after Send" />}
            </div>
          )}

          {blocked && c.ctx && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-ink space-y-2">
              <p>
                AI won&rsquo;t send this form (it&rsquo;s protected by a CAPTCHA, or couldn&rsquo;t be filled honestly). You can send it yourself: write the message
                below, copy it, open their page, paste it, tick the box and send. Then press <span className="font-semibold">I sent it myself</span>.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={copyMessage} disabled={!c.body.trim()}>
                  <Copy className="h-3.5 w-3.5" /> Copy message
                </Button>
                {pageUrl && (
                  <a href={pageUrl} target="_blank" rel="noreferrer" className="btn btn-soft btn-sm">
                    Open their contact page <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}

          {(ready || blocked) && c.ctx && (
            <ComposeFields
              c={c}
              busy={posting}
              bodyLabel="Message"
              showSpam={false}
              hint="This goes into their form exactly as written. Phone and anything we don't know stay empty."
              fromNote="Your name and this address go in the form; their reply comes to this inbox."
            />
          )}
        </div>

        <footer className="px-5 py-3 border-t border-rule flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink-muted min-w-0 flex-1">
            {ready
              ? `Sending costs about ${cents}¢ (AI fills the form). It's sent once and can't be undone.`
              : blocked
                ? "Sending it yourself is free; I sent it myself just records it."
                : "Looking at their form is free."}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>{afterSend ? "Close" : "Cancel"}</Button>
            {ready && (
              <Button onClick={send} loading={posting} disabled={!canSend}>
                <Send strokeWidth={2} /> Send via their form
              </Button>
            )}
            {blocked && (
              <Button onClick={sentByHand} loading={posting} disabled={posting || !c.body.trim()} title="Record that you sent this message through their form yourself">
                <Check strokeWidth={2} /> I sent it myself
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
