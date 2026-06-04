"use client";

/**
 * ConnectBluehostModal.tsx — Form to connect a Bluehost / Titan mailbox.
 *
 * Inputs:  email, fromName, password, smtp/imap host+port (prefilled for Titan)
 * Outputs: POST /api/email-accounts/bluehost → inserts row, returns warning if IMAP unreachable
 * Used by: app/(dashboard)/email-accounts/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Mail, AlertTriangle } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/Button";

export function ConnectBluehostModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [password, setPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.titan.email");
  const [smtpPort, setSmtpPort] = useState("465");
  const [imapHost, setImapHost] = useState("imap.titan.email");
  const [imapPort, setImapPort] = useState("993");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setWarning(null);
    setSubmitting(true);
    const json = await fetchJson<{ id: string; warning?: string }>("/api/email-accounts/bluehost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        fromName: fromName || undefined,
        password,
        smtpHost,
        smtpPort,
        imapHost,
        imapPort,
      }),
    });
    setSubmitting(false);

    if (!json.success) {
      setError(json.error);
      return;
    }

    if (json.data && "warning" in json.data && json.data.warning) {
      setWarning(json.data.warning as string);
      return;
    }

    onClose();
    router.refresh();
  }

  function continueAnyway() {
    onClose();
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <section
        className="bg-white w-full max-w-[560px] rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-rule flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-action" />
            <h2 className="text-headline-sm">Connect Bluehost (Titan)</h2>
          </div>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink-muted">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-6 space-y-4">
          <Field label="Email address">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourdomain.com"
              className={inputCls}
              autoComplete="off"
            />
          </Field>

          <Field label="From name (optional)">
            <input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Your name or company"
              className={inputCls}
              autoComplete="off"
            />
          </Field>

          <Field label="Mailbox password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputCls}
              autoComplete="new-password"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="SMTP host">
              <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className={inputCls} />
            </Field>
            <Field label="SMTP port">
              <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="IMAP host">
              <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} className={inputCls} />
            </Field>
            <Field label="IMAP port">
              <input value={imapPort} onChange={(e) => setImapPort(e.target.value)} className={inputCls} />
            </Field>
          </div>

          {warning && (
            <div className="rounded-lg bg-warning-soft border border-warning/30 px-4 py-3 text-warning flex gap-2 text-[13px]">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-warning" />
              <span>{warning}</span>
            </div>
          )}

          <div className="rounded-lg bg-surface-alt border border-rule px-4 py-3 text-[12px] text-ink-muted leading-relaxed">
            <span className="font-semibold">Bluehost Titan defaults:</span> SMTP{" "}
            <code className="text-ink">smtp.titan.email:465</code> (SSL), IMAP{" "}
            <code className="text-ink">imap.titan.email:993</code> (TLS). Username is your full email address.
          </div>
        </div>

        <footer className="px-6 py-4 bg-surface-alt border-t border-rule flex justify-between items-center gap-3">
          {error ? <p className="text-[12px] text-urgent font-medium">{error}</p> : <span />}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {warning ? (
              <Button variant="primary" onClick={continueAnyway}>
                Continue anyway
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={submit}
                loading={submitting}
                disabled={!email || !password}
              >
                {submitting ? "Verifying…" : "Connect"}
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

const inputCls =
  "w-full h-9 px-3 text-body-base border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-label-caps text-ink-muted uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}
