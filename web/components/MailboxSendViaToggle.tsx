"use client";

/**
 * MailboxSendViaToggle.tsx — per-mailbox "Send via: Mailbox / Ongage" switch.
 *
 * Inputs:  { id, email, emailProvider, ongageReady }
 * Outputs: PATCH /api/email-accounts/:id { email_provider } → toast + refresh
 * Used by: app/(dashboard)/email-accounts/page.tsx
 *
 * Ongage sends under the same address and replies still arrive in the mailbox,
 * so only the outbound path changes. The Ongage option stays disabled until
 * the server has the Ongage settings (ongageReady).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

type Provider = "smtp" | "ongage";

export function MailboxSendViaToggle({
  id,
  email,
  emailProvider,
  ongageReady,
}: {
  id: string;
  email: string;
  emailProvider: string | null;
  ongageReady: boolean;
}) {
  const router = useRouter();
  const current: Provider = emailProvider === "ongage" ? "ongage" : "smtp";
  const [busy, setBusy] = useState(false);

  async function choose(next: Provider) {
    if (next === current || busy) return;
    setBusy(true);
    const res = await fetchJson(`/api/email-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_provider: next }),
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error, { title: "Couldn't change how this mailbox sends" });
      return;
    }
    toast.success(next === "ongage" ? `${email} now sends through Ongage.` : `${email} now sends from its own mailbox.`);
    router.refresh();
  }

  const option = (value: Provider, label: string, disabled: boolean, title: string) => (
    <button
      type="button"
      onClick={() => choose(value)}
      disabled={disabled || busy}
      aria-pressed={current === value}
      title={title}
      className={`px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50 ${
        current === value ? "bg-action text-white" : "text-ink-muted hover:bg-surface-alt"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-1.5 mt-1.5 text-[12px] text-ink-muted">
      <span className="uppercase tracking-wider text-[10px] font-semibold text-ink-subtle">Send via</span>
      <div className="inline-flex rounded border border-rule overflow-hidden divide-x divide-rule">
        {option("smtp", "Mailbox", false, "Send over this mailbox's own SMTP login")}
        {option(
          "ongage",
          "Ongage",
          !ongageReady && current !== "ongage",
          ongageReady
            ? "Send through Ongage from this address. Replies still come to this mailbox."
            : "Ongage isn't set up on the server yet",
        )}
      </div>
    </div>
  );
}
