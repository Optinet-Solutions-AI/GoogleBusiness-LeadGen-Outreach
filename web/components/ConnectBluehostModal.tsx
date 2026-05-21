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
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <section
        className="bg-white w-full max-w-[560px] rounded-xl border border-slate-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-brand" />
            <h2 className="text-headline-sm">Connect Bluehost (Titan)</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
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
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-amber-900 flex gap-2 text-[13px]">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
              <span>{warning}</span>
            </div>
          )}

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-[12px] text-slate-600 leading-relaxed">
            <span className="font-semibold">Bluehost Titan defaults:</span> SMTP{" "}
            <code className="text-slate-800">smtp.titan.email:465</code> (SSL), IMAP{" "}
            <code className="text-slate-800">imap.titan.email:993</code> (TLS). Username is your full email address.
          </div>
        </div>

        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center gap-3">
          {error ? <p className="text-[12px] text-rose-600 font-medium">{error}</p> : <span />}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2 rounded-full text-slate-600 font-medium hover:bg-slate-200 text-sm">
              Cancel
            </button>
            {warning ? (
              <button
                onClick={continueAnyway}
                className="px-6 py-2 rounded-full bg-brand text-white font-semibold text-sm"
              >
                Continue anyway
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting || !email || !password}
                className="px-6 py-2 rounded-full bg-brand text-white font-semibold text-sm disabled:opacity-50"
              >
                {submitting ? "Verifying…" : "Connect"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

const inputCls =
  "w-full h-9 px-3 text-body-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-label-caps text-slate-500 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}
