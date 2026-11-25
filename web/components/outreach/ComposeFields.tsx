/**
 * outreach/ComposeFields.tsx — the shared "write the message" fields: From mailbox, What are you offering?,
 * demo-link switch, Regenerate / Save as template, subject, message, and the warnings that block sending.
 *
 * Inputs:  the state from useEmailCompose (one lead), whether the window is busy, a few labels
 * Outputs: renders the fields; every change goes back through the hook's setters
 * Used by: components/outreach/SimpleEmailModal.tsx, components/outreach/ContactFormModal.tsx
 */
"use client";

import { Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import { SERVICES, greetingLine } from "@/lib/email/service-templates";
import type { EmailCompose } from "./useEmailCompose";

export const INPUT =
  "w-full px-3 text-[13px] text-ink border border-rule-strong rounded-md bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none disabled:bg-surface-alt";
export const LABEL = "block text-[11px] font-semibold text-ink-muted mb-1";

export function ComposeFields({
  c,
  busy,
  bodyLabel = "Email",
  hint = "Plain text, sent exactly as written. A blank line starts a new paragraph.",
  showSpam = true,
  fromNote,
}: {
  c: EmailCompose;
  busy: boolean;
  bodyLabel?: string;
  hint?: string;
  showSpam?: boolean;
  /** One line under the From box (e.g. "Their reply comes to this address"). */
  fromNote?: string;
}) {
  const { ctx, mailboxes } = c;
  if (!ctx) return null;
  return (
    <>
      <dl className="grid grid-cols-[56px_1fr] items-center gap-x-3 gap-y-2 text-[12px]">
        <dt className="text-ink-muted">From</dt>
        <dd className="min-w-0">
          {mailboxes === null ? (
            <span className="text-ink-subtle">Loading mailboxes…</span>
          ) : c.noMailbox ? (
            <span className="text-urgent">No sending mailbox is connected. Connect one on the Email page first.</span>
          ) : mailboxes.length === 1 ? (
            <span className="text-ink break-all">{mailboxes[0].email}</span>
          ) : (
            <select value={c.from} onChange={(e) => c.pickMailbox(e.target.value)} disabled={busy} aria-label="Send from" className={cx(INPUT, "h-8")}>
              {mailboxes.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.from_name ? `${m.from_name} <${m.email}>` : m.email}
                </option>
              ))}
            </select>
          )}
          {fromNote && <span className="block mt-1 text-[11px] text-ink-subtle">{fromNote}</span>}
        </dd>
      </dl>

      <label className="block">
        <span className={LABEL}>What are you offering?</span>
        <select
          value={c.savedId ? `saved:${c.savedId}` : c.service}
          onChange={(e) => c.pickService(e.target.value)}
          disabled={busy}
          aria-label="Service"
          className={cx(INPUT, "h-9")}
        >
          <optgroup label="Ready-made">
            {SERVICES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
                {s.key === ctx.defaultService ? " (fits this lead)" : ""}
              </option>
            ))}
          </optgroup>
          {c.saved.length > 0 && (
            <optgroup label="Saved templates">
              {c.saved.map((t) => (
                <option key={t.id} value={`saved:${t.id}`}>
                  {t.name}
                  {t.service_key === ctx.defaultService ? " (fits this lead)" : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <label className="block">
        <span className={LABEL}>Greeting</span>
        <select
          value={c.greet}
          onChange={(e) => c.pickGreeting(e.target.value as "none" | "business" | "contact")}
          disabled={busy}
          aria-label="Greeting"
          className={cx(INPUT, "h-9")}
        >
          <option value="none">Hi there, (no name)</option>
          <option value="business">Hey {ctx.businessName} team,</option>
          <option value="contact" disabled={!ctx.ownerName}>
            {ctx.ownerName ? greetingLine({ ...ctx, greeting: "contact" }) : "Hi {contact name}, (no contact name on file)"}
          </option>
        </select>
      </label>

      {ctx.demoUrl && c.linkOffer && (
        <label className="flex items-center gap-2 text-[12px] text-ink">
          <input type="checkbox" checked={c.includeLink} onChange={(e) => c.toggleLink(e.target.checked)} disabled={busy} />
          Include the demo website link <span className="text-ink-subtle break-all">({ctx.demoUrl})</span>
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => c.regenerate()} disabled={busy || c.regenerating || !c.subject.trim() || !c.body.trim()}>
          <Sparkles className="h-3.5 w-3.5" /> {c.regenerating ? "Rewriting…" : "Regenerate"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => c.regenerate(true)} disabled={busy || c.regenerating || !c.subject.trim() || !c.body.trim()}>
          <Sparkles className="h-3.5 w-3.5" /> New subject line
        </Button>
        <Button size="sm" variant="ghost" onClick={c.saveAsTemplate} disabled={busy || c.savingTpl || !c.subject.trim() || !c.body.trim()}>
          <Save className="h-3.5 w-3.5" /> {c.savingTpl ? "Saving…" : "Save as template"}
        </Button>
        {c.savedId && (
          <Button size="sm" variant="ghost" onClick={c.deleteSaved} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" /> Delete this template
          </Button>
        )}
      </div>

      <input
        value={c.subject}
        onChange={(e) => c.setSubject(e.target.value)}
        disabled={busy}
        placeholder="Subject"
        aria-label="Subject"
        maxLength={200}
        className={cx(INPUT, "h-9 font-semibold")}
      />
      <textarea
        value={c.body}
        onChange={(e) => c.setBody(e.target.value)}
        disabled={busy}
        rows={11}
        aria-label={bodyLabel}
        maxLength={10000}
        className={cx(INPUT, "py-2 leading-relaxed resize-y")}
      />
      <p className="text-[11px] text-ink-subtle">{hint}</p>
      {c.leftovers.length > 0 && (
        <p className="text-[12px] text-urgent">
          Fix before sending: {c.leftovers.map((t) => `{{${t}}}`).join(", ")} isn&rsquo;t filled in (a typo in the template, or this lead has no value for it).
        </p>
      )}
      {c.demoGap && (
        <p className="text-[12px] text-urgent">
          This template talks about the demo website, but {ctx.demoUrl ? "the link is switched off" : "this lead has no demo site yet"}. Rewrite that part, switch the link on, or pick another template.
        </p>
      )}
      {showSpam && c.spam && c.spam.level !== "low" && (
        <p className="text-[11px] text-warning">
          Spam-filter risk: {c.spam.level}. {c.spam.flags.slice(0, 3).join(" · ")}
        </p>
      )}
    </>
  );
}
