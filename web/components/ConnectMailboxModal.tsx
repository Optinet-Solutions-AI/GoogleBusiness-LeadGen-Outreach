"use client";

/**
 * ConnectMailboxModal.tsx — connect a sending mailbox (ANY provider).
 *
 * A provider preset (Bluehost/Titan · Gmail · Outlook/Microsoft 365 · Other) fills
 * the SMTP + IMAP host/port; you enter your own address + password (Gmail/Outlook
 * need an App Password). Verifies SMTP (+ soft IMAP) before saving.
 * POST /api/email-accounts/bluehost (accepts a provider label + custom hosts).
 * Used by: app/(dashboard)/email-accounts/page.tsx (the "Connect mailbox" action).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Mail, AlertTriangle } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/Button";

type ProviderKey = "titan" | "gmail" | "outlook" | "other";

const PRESETS: Record<
  ProviderKey,
  {
    label: string;
    providerName: string;
    smtpHost: string;
    smtpPort: string;
    imapHost: string;
    imapPort: string;
    note?: string;
  }
> = {
  titan: {
    label: "Bluehost / Titan",
    providerName: "Bluehost (Titan SMTP)",
    smtpHost: "smtp.titan.email",
    smtpPort: "465",
    imapHost: "imap.titan.email",
    imapPort: "993",
  },
  gmail: {
    label: "Gmail",
    providerName: "Gmail (SMTP)",
    smtpHost: "smtp.gmail.com",
    smtpPort: "465",
    imapHost: "imap.gmail.com",
    imapPort: "993",
    note: "Gmail needs a 16-character App Password (Google account → Security → 2-Step Verification → App passwords), NOT your normal login password.",
  },
  outlook: {
    label: "Outlook / Microsoft 365",
    providerName: "Outlook (SMTP)",
    smtpHost: "smtp.office365.com",
    smtpPort: "587",
    imapHost: "outlook.office365.com",
    imapPort: "993",
    note: "Microsoft 365 may need an app password, and some tenants disable SMTP auth — ask your admin if it fails.",
  },
  other: {
    label: "Other (custom SMTP)",
    providerName: "SMTP",
    smtpHost: "",
    smtpPort: "465",
    imapHost: "",
    imapPort: "993",
  },
};

export function ConnectMailboxModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [provider, setProvider] = useState<ProviderKey>("titan");
  const [email, setEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [password, setPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState(PRESETS.titan.smtpHost);
  const [smtpPort, setSmtpPort] = useState(PRESETS.titan.smtpPort);
  const [imapHost, setImapHost] = useState(PRESETS.titan.imapHost);
  const [imapPort, setImapPort] = useState(PRESETS.titan.imapPort);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  function pickProvider(key: ProviderKey) {
    setProvider(key);
    const p = PRESETS[key];
    setSmtpHost(p.smtpHost);
    setSmtpPort(p.smtpPort);
    setImapHost(p.imapHost);
    setImapPort(p.imapPort);
  }

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
        provider: PRESETS[provider].providerName,
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

  const note = PRESETS[provider].note;

  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <section
        className="bg-white w-full max-w-[560px] rounded-xl border border-rule shadow-xl max-h-[calc(100vh-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-rule flex justify-between items-center sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-ink" />
            <h2 className="text-headline-sm">Connect a mailbox</h2>
          </div>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink-muted">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-6 space-y-4">
          <Field label="Provider">
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(PRESETS) as ProviderKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => pickProvider(key)}
                  className={[
                    "px-3 py-2 rounded-lg text-[12px] font-semibold border text-left transition-colors",
                    provider === key
                      ? "bg-ink text-canvas border-ink"
                      : "bg-surface-alt border-rule text-ink-muted hover:text-ink",
                  ].join(" ")}
                >
                  {PRESETS[key].label}
                </button>
              ))}
            </div>
          </Field>

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

          <Field label={provider === "gmail" || provider === "outlook" ? "App password" : "Mailbox password"}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputCls}
              autoComplete="new-password"
            />
          </Field>

          {note && (
            <div className="rounded-lg bg-warning-soft border border-warning/30 px-4 py-3 text-warning flex gap-2 text-[12.5px]">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-warning" />
              <span>{note}</span>
            </div>
          )}

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

          <p className="text-[11px] text-ink-subtle leading-relaxed">
            We verify the SMTP login before saving. Username is your full email address. SMTP/IMAP
            credentials are stored on your Supabase project.
          </p>
        </div>

        <footer className="px-6 py-4 bg-surface-alt border-t border-rule flex justify-between items-center gap-3 sticky bottom-0">
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
                disabled={!email || !password || !smtpHost}
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
